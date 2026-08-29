package momo.api.adapters.postgres

import java.security.MessageDigest
import java.time.Instant

import scala.collection.mutable
import scala.util.control.NoStackTrace

import cats.syntax.all.*
import io.circe.jawn.JawnParser
import io.circe.{Json, Printer}

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MatchId}
import momo.api.errors.AppError

private[postgres] final case class SeriesAnalysisStoredChunk(
    artifactId: String,
    artifactGameTitleId: GameTitleId,
    inputRevision: Long,
    algorithmVersion: String,
    artifactSchemaVersion: Int,
    validationContractId: Option[String],
    publishedAt: Instant,
    scopeKind: Option[String],
    payload: Option[Array[Byte]],
    encodedBytes: Option[Int],
    decodedBytes: Option[Int],
    itemCount: Option[Int],
    nestingDepth: Option[Int],
    checksum: Option[String],
)

/**
 * Validated JSON retained only inside the Postgres adapter. The repository boundary exposes the
 * final bounded UTF-8 bytes, so HTTP rendering cannot create another full JSON String.
 */
private[postgres] final case class DecodedSeriesAnalysisChunk(
    artifact: SeriesAnalysisArtifactRef,
    scope: SeriesAnalysisScope,
    payload: Json,
    memberIds: List[String],
    nodeCount: Int,
)

// Allocation-free bounded scans, copy-on-write hydration and Appendable counters are deliberately
// imperative so a maximum chunk does not create iterator and accumulator copies.
// scalafix:off DisableSyntax.var
private[postgres] object PostgresSeriesAnalysisChunkCodec:
  private val MaximumMemberCount = 4

  private final case class JsonInspection(
      depth: Int,
      nodeCount: Int,
      memberIds: List[String],
      tooManyMembers: Boolean,
      invalidUnicode: Boolean,
  )

  def decode(
      row: SeriesAnalysisStoredChunk,
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
      sourceMatchRevision: Option[Long],
  ): Either[AppError, DecodedSeriesAnalysisChunk] =
    val artifact = SeriesAnalysisArtifactRef(
      row.artifactId,
      row.artifactGameTitleId,
      row.inputRevision,
      row.algorithmVersion,
      row.artifactSchemaVersion,
      row.publishedAt,
    )
    val metadata = (
      row.scopeKind,
      row.payload,
      row.encodedBytes,
      row.decodedBytes,
      row.itemCount,
      row.nestingDepth,
      row.checksum,
    ).tupled.toRight(AppError.AnalysisScopeNotInArtifact())
    metadata.flatMap { case (scopeKind, payload, encoded, decoded, itemCount, depth, checksum) =>
      val metadataValid =
        SeriesAnalysisArtifactSupport.supports(
          row.artifactSchemaVersion,
          row.validationContractId,
        ) &&
          scopeKind == request.scope.kind && encoded >= 2 && decoded == encoded && itemCount >= 0 &&
          depth >= 1 && encoded.toLong <= config.maxEncodedBytes &&
          decoded.toLong <= config.maxDecodedBytes && itemCount <= config.maxItemCount &&
          depth <= config.maxNestingDepth && payload.length == encoded &&
          checksum == sha256(payload)
      for
        _ <- Either.cond(
          metadataValid,
          (),
          AppError.Internal(
            "Invalid analysis artifact metadata."
          )
        )
        _ <- validateUtf8(payload)
        _ <- Either.cond(
          jsonTextDepthWithin(payload, config.maxNestingDepth),
          (),
          AppError.Internal("Analysis artifact exceeds the JSON nesting bound."),
        )
        json <- JawnParser(math.min(config.maxDecodedBytes, Int.MaxValue.toLong).toInt)
          .parseByteArray(payload)
          .leftMap(_ => AppError.Internal("Invalid analysis artifact payload."))
        inspection <- inspectJson(json, config.maxNestingDepth, config.maxJsonNodes)
        _ <- Either.cond(
          !inspection.tooManyMembers,
          (),
          AppError.Internal("Analysis artifact contains too many member identifiers."),
        )
        _ <- Either.cond(
          !inspection.invalidUnicode,
          (),
          AppError.Internal("Analysis artifact contains invalid Unicode."),
        )
        _ <- validateDecodedJson(
          json,
          request,
          itemCount,
          sourceMatchRevision,
          depth,
          inspection.depth,
        )
      yield DecodedSeriesAnalysisChunk(
        artifact,
        request.scope,
        json,
        inspection.memberIds,
        inspection.nodeCount,
      )
    }

  def hydrateAndRender(
      chunk: DecodedSeriesAnalysisChunk,
      memberNames: Map[String, String],
      scopeName: Option[String],
      config: SeriesAnalysisReadConfig,
  ): Either[AppError, SeriesAnalysisChunk] = scopeName
    .filter(displayName =>
      displayName.nonEmpty && memberNames.values.forall(_.nonEmpty) &&
        memberNames.keySet == chunk.memberIds.toSet
    )
    .toRight(AppError.Internal("Analysis display metadata is unavailable."))
    .flatMap { displayName =>
      Either.cond(
        chunk.nodeCount <= config.maxJsonNodes,
        hydratePayload(chunk, memberNames, displayName),
        AppError.Internal("Analysis artifact exceeds the JSON node bound."),
      )
    }
    .flatMap(renderJson(_, config.maxResponseBytes))
    .map(bytes => SeriesAnalysisChunk(chunk.artifact, chunk.scope, bytes))

  def includedContext(
      chunk: DecodedSeriesAnalysisChunk,
      sourceMatchRevision: Long,
  ): DecodedSeriesAnalysisChunk = chunk.copy(
    payload = chunk.payload.mapObject(
      _.remove("sourceMatchRevision").add(
        "inclusion",
        Json.obj(
          "status" -> Json.fromString("included"),
          "sourceMatchRevision" -> Json.fromString(sourceMatchRevision.toString),
        ),
      )
    ),
    // The stored revision string moves under `inclusion`; only its wrapper and status add nodes.
    nodeCount = chunk.nodeCount + 2,
  )

  def excludedContext(
      artifact: SeriesAnalysisArtifactRef,
      scope: SeriesAnalysisScope,
      matchId: MatchId,
      reason: SeriesAnalysisMatchContextExclusion,
  ): DecodedSeriesAnalysisChunk =
    val payload = Json.obj(
      "schemaVersion" -> Json.fromInt(1),
      "artifact" -> artifactJson(artifact),
      "scope" -> scopeJson(scope),
      "matchId" -> Json.fromString(matchId.value),
      "inclusion" -> Json.obj("status" -> Json.fromString(reason.wire)),
      "match" -> Json.Null,
    )
    DecodedSeriesAnalysisChunk(
      artifact,
      scope,
      payload,
      memberIds = Nil,
      nodeCount = jsonNodeCount(payload),
    )

  private[postgres] def renderJson(
      json: Json,
      maximumBytes: Long,
  ): Either[AppError, Array[Byte]] =
    try
      val counter = new CountingUtf8Appendable(maximumBytes)
      Printer.noSpaces.unsafePrintToAppendable(json, counter)
      val output = new Array[Byte](counter.size)
      val writer = new ArrayUtf8Appendable(output)
      Printer.noSpaces.unsafePrintToAppendable(json, writer)
      Either.cond(
        writer.size == output.length,
        output,
        AppError.Internal("Analysis response encoding failed."),
      )
    catch
      case _: Utf8LimitExceeded =>
        AppError.Internal("Analysis response exceeds the configured bound.").asLeft

  private def hydratePayload(
      chunk: DecodedSeriesAnalysisChunk,
      names: Map[String, String],
      scopeName: String,
  ): Json =
    val memberHydrated = hydrateMemberObjects(chunk.payload, names)._1
    val storedScope = memberHydrated.hcursor.downField("scope").focus
      .flatMap(_.asObject).orElse(scopeJson(chunk.scope).asObject)
      .getOrElse(io.circe.JsonObject.empty)
    val hydratedScope = Json.fromJsonObject(
      storedScope.add("displayName", Json.fromString(scopeName))
    )
    memberHydrated.mapObject(jsonObject =>
      jsonObject
        .add("artifact", artifactJson(chunk.artifact))
        .add("scope", hydratedScope)
    )

  /** Returns the original subtree when no descendant needs display-name hydration. */
  private def hydrateMemberObjects(
      json: Json,
      names: Map[String, String],
  ): (Json, Boolean) = json.arrayOrObject(
    json -> false,
    values =>
      var hydrated = values
      var changed = false
      var index = 0
      while index < values.length do
        val (child, childChanged) = hydrateMemberObjects(values(index), names)
        if childChanged then
          hydrated = hydrated.updated(index, child)
          changed = true
        index += 1
      if changed then Json.fromValues(hydrated) -> true else json -> false
    ,
    fields =>
      var hydrated = fields
      var changed = false
      fields.toIterable.foreach { case (key, value) =>
        val (child, childChanged) = hydrateMemberObjects(value, names)
        if childChanged then
          hydrated = hydrated.add(key, child)
          changed = true
      }
      fields("memberId").flatMap(_.asString).flatMap(names.get).foreach { name =>
        hydrated = hydrated.add("displayName", Json.fromString(name))
        changed = true
      }
      if changed then Json.fromJsonObject(hydrated) -> true else json -> false,
  )

  private def validateUtf8(payload: Array[Byte]): Either[AppError, Unit] = Either.cond(
    isValidUtf8(payload),
    (),
    AppError.Internal("Invalid UTF-8 analysis artifact payload."),
  )

  /** Strict RFC 3629 validation without allocating a decoded character buffer. */
  private def isValidUtf8(bytes: Array[Byte]): Boolean =
    def continuation(index: Int): Boolean =
      index < bytes.length && (bytes(index) & 0xc0) == 0x80

    var index = 0
    var valid = true
    while valid && index < bytes.length do
      val first = bytes(index) & 0xff
      if first <= 0x7f then index += 1
      else if first >= 0xc2 && first <= 0xdf then
        valid = continuation(index + 1)
        index += 2
      else if first == 0xe0 then
        valid = index + 2 < bytes.length && {
          val second = bytes(index + 1) & 0xff
          second >= 0xa0 && second <= 0xbf && continuation(index + 2)
        }
        index += 3
      else if (first >= 0xe1 && first <= 0xec) || (first >= 0xee && first <= 0xef) then
        valid = continuation(index + 1) && continuation(index + 2)
        index += 3
      else if first == 0xed then
        valid = index + 2 < bytes.length && {
          val second = bytes(index + 1) & 0xff
          second >= 0x80 && second <= 0x9f && continuation(index + 2)
        }
        index += 3
      else if first == 0xf0 then
        valid = index + 3 < bytes.length && {
          val second = bytes(index + 1) & 0xff
          second >= 0x90 && second <= 0xbf && continuation(index + 2) &&
          continuation(index + 3)
        }
        index += 4
      else if first >= 0xf1 && first <= 0xf3 then
        valid = continuation(index + 1) && continuation(index + 2) && continuation(index + 3)
        index += 4
      else if first == 0xf4 then
        valid = index + 3 < bytes.length && {
          val second = bytes(index + 1) & 0xff
          second >= 0x80 && second <= 0x8f && continuation(index + 2) &&
          continuation(index + 3)
        }
        index += 4
      else valid = false
    valid

  private def jsonTextDepthWithin(bytes: Array[Byte], maximumDepth: Int): Boolean =
    var index = 0
    var depth = 0
    var inString = false
    var escaped = false
    var valid = true
    while valid && index < bytes.length do
      val character = bytes(index) & 0xff
      if inString then
        if escaped then escaped = false
        else if character == '\\' then escaped = true
        else if character == '"' then inString = false
      else if character == '"' then inString = true
      else if character == '{' || character == '[' then
        if depth >= maximumDepth then valid = false else depth += 1
      else if character == '}' || character == ']' then
        if depth <= 0 then valid = false else depth -= 1
      index += 1
    valid && !inString && depth == 0

  private def inspectJson(
      json: Json,
      maximumDepth: Int,
      maximumNodes: Int,
  ): Either[AppError, JsonInspection] =
    val memberIds = mutable.HashSet.empty[String]
    val pending = mutable.ArrayDeque.empty[(Iterator[Json], Int)]
    var current = Option(json -> 1)
    var deepest = 0
    var nodeCount = 0
    var tooManyMembers = false
    var invalidUnicode = false

    def nextNode(): Option[(Json, Int)] =
      var next = Option.empty[(Json, Int)]
      while next.isEmpty && pending.nonEmpty do
        val (values, depth) = pending.last
        if values.hasNext then next = Some(values.next() -> depth)
        else
          val _ = pending.removeLast()
      next

    while current.nonEmpty && nodeCount <= maximumNodes && deepest <= maximumDepth do
      val (value, depth) = current.get
      nodeCount += 1
      deepest = math.max(deepest, depth)
      value.asString.foreach(string => invalidUnicode ||= !isUnicodeScalarString(string))
      val children = value.arrayOrObject(
        Iterator.empty,
        _.iterator,
        fields =>
          fields.keys.foreach(key => invalidUnicode ||= !isUnicodeScalarString(key))
          fields("memberId").flatMap(_.asString).filter(_.nonEmpty).foreach { memberId =>
            if memberIds.size < MaximumMemberCount || memberIds.contains(memberId) then
              val _ = memberIds.add(memberId)
            else tooManyMembers = true
          }
          fields.values.iterator,
      )
      if children.hasNext then pending.append(children -> (depth + 1))
      current = nextNode()

    if nodeCount > maximumNodes then
      AppError.Internal("Analysis artifact exceeds the JSON node bound.").asLeft
    else if deepest > maximumDepth then
      AppError.Internal("Analysis artifact exceeds the JSON nesting bound.").asLeft
    else
      JsonInspection(
        deepest,
        nodeCount,
        memberIds.toList.sorted,
        tooManyMembers,
        invalidUnicode,
      ).asRight

  private def isUnicodeScalarString(value: String): Boolean =
    var index = 0
    var valid = true
    while valid && index < value.length do
      val character = value.charAt(index)
      if Character.isHighSurrogate(character) then
        valid = index + 1 < value.length && Character.isLowSurrogate(value.charAt(index + 1))
        index += 2
      else if Character.isLowSurrogate(character) then valid = false
      else index += 1
    valid

  private def jsonNodeCount(value: Json): Int = value.arrayOrObject(
    1,
    values => 1 + values.map(jsonNodeCount).sum,
    fields => 1 + fields.values.map(jsonNodeCount).sum,
  )

  private def validateDecodedJson(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
      sourceMatchRevision: Option[Long],
      declaredDepth: Int,
      actualDepth: Int,
  ): Either[AppError, Unit] = Either.cond(
    SeriesAnalysisPayloadValidator.validate(
      json,
      request,
      itemCount,
      sourceMatchRevision,
    ) && actualDepth == declaredDepth,
    (),
    AppError.Internal("Analysis artifact schema validation failed."),
  )

  private def sha256(bytes: Array[Byte]): String =
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    s"sha256:${digest.map(value => f"${value & 0xff}%02x").mkString}"

  private def artifactJson(value: SeriesAnalysisArtifactRef): Json = Json.obj(
    "artifactId" -> Json.fromString(value.artifactId),
    "gameTitleId" -> Json.fromString(value.gameTitleId.value),
    "inputRevision" -> Json.fromString(value.inputRevision.toString),
    "algorithmVersion" -> Json.fromString(value.algorithmVersion),
    "artifactSchemaVersion" -> Json.fromInt(value.artifactSchemaVersion),
    "publishedAt" -> Json.fromString(value.publishedAt.toString),
  )

  private def scopeJson(value: SeriesAnalysisScope): Json = Json.obj(
    List(
      Some("kind" -> Json.fromString(value.kind)),
      value.seasonMasterId.map(id => "seasonMasterId" -> Json.fromString(id.value)),
      value.mapMasterId.map(id => "mapMasterId" -> Json.fromString(id.value)),
    ).flatten*
  )

  private final class Utf8LimitExceeded extends RuntimeException with NoStackTrace

  private abstract class Utf8Appendable extends Appendable:
    def size: Int
    protected def writeByte(value: Int): Unit

    final override def append(value: CharSequence): Appendable =
      val actual = java.util.Objects.requireNonNullElse(value, "null")
      append(actual, 0, actual.length)

    final override def append(value: CharSequence, start: Int, end: Int): Appendable =
      val actual = java.util.Objects.requireNonNullElse(value, "null")
      var index = start
      while index < end do
        val character = actual.charAt(index)
        if character <= 0x7f then writeByte(character)
        else if character <= 0x7ff then
          writeByte(0xc0 | character >> 6)
          writeByte(0x80 | character & 0x3f)
        else if Character.isHighSurrogate(character) && index + 1 < end &&
          Character.isLowSurrogate(actual.charAt(index + 1))
        then
          val codePoint = Character.toCodePoint(character, actual.charAt(index + 1))
          writeByte(0xf0 | codePoint >> 18)
          writeByte(0x80 | codePoint >> 12 & 0x3f)
          writeByte(0x80 | codePoint >> 6 & 0x3f)
          writeByte(0x80 | codePoint & 0x3f)
          index += 1
        else if Character.isSurrogate(character) then writeByte('?')
        else
          writeByte(0xe0 | character >> 12)
          writeByte(0x80 | character >> 6 & 0x3f)
          writeByte(0x80 | character & 0x3f)
        index += 1
      this

    final override def append(value: Char): Appendable =
      if value <= 0x7f then writeByte(value)
      else if value <= 0x7ff then
        writeByte(0xc0 | value >> 6)
        writeByte(0x80 | value & 0x3f)
      else if Character.isSurrogate(value) then writeByte('?')
      else
        writeByte(0xe0 | value >> 12)
        writeByte(0x80 | value >> 6 & 0x3f)
        writeByte(0x80 | value & 0x3f)
      this

  // Appendable cannot return Either; this private sentinel aborts Printer immediately at the byte
  // bound and is caught at renderJson's module boundary.
  // scalafix:off DisableSyntax.throw
  private final class CountingUtf8Appendable(maximumBytes: Long) extends Utf8Appendable:
    private var written = 0
    override def size: Int = written
    override protected def writeByte(value: Int): Unit =
      if written.toLong >= maximumBytes || written == Int.MaxValue then
        throw new Utf8LimitExceeded
      written += 1

  private final class ArrayUtf8Appendable(output: Array[Byte]) extends Utf8Appendable:
    private var written = 0
    override def size: Int = written
    override protected def writeByte(value: Int): Unit =
      if written >= output.length then throw new Utf8LimitExceeded
      output(written) = value.toByte
      written += 1
  // scalafix:on DisableSyntax.throw

end PostgresSeriesAnalysisChunkCodec
// scalafix:on DisableSyntax.var
