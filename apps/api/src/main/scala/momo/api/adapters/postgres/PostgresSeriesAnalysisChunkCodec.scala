package momo.api.adapters.postgres

import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.security.MessageDigest
import java.time.Instant

import scala.annotation.tailrec
import scala.collection.mutable
import scala.util.Try

import cats.syntax.all.*
import io.circe.Json
import io.circe.parser.parse

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
    publishedAt: Instant,
    scopeKind: Option[String],
    payload: Option[Array[Byte]],
    encodedBytes: Option[Int],
    decodedBytes: Option[Int],
    itemCount: Option[Int],
    nestingDepth: Option[Int],
    checksum: Option[String],
)

private[postgres] object PostgresSeriesAnalysisChunkCodec:
  private val SupportedArtifactSchemas =
    SeriesAnalysisArtifactSupport.SupportedArtifactSchemas
  private val MaximumMemberCount = 4

  def decode(
      row: SeriesAnalysisStoredChunk,
      request: SeriesAnalysisChunkRequest,
      config: SeriesAnalysisReadConfig,
      sourceMatchRevision: Option[Long],
  ): Either[AppError, SeriesAnalysisChunk] =
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
        SupportedArtifactSchemas.contains(row.artifactSchemaVersion) &&
          scopeKind == request.scope.kind && encoded >= 2 && decoded == encoded && itemCount >= 0 &&
          depth >= 1 && encoded.toLong <= config.maxEncodedBytes &&
          decoded.toLong <= config.maxDecodedBytes && itemCount <= config.maxItemCount &&
          depth <= config.maxNestingDepth && payload.length == encoded &&
          checksum == sha256(payload)
      Either.cond(metadataValid, (), AppError.Internal("Invalid analysis artifact metadata."))
        .flatMap(_ => decodeUtf8(payload))
        .flatMap(value =>
          Either.cond(
            jsonTextDepthWithin(value, config.maxNestingDepth),
            value,
            AppError.Internal("Analysis artifact exceeds the JSON nesting bound."),
          )
        )
        .flatMap(value =>
          parse(value)
            .leftMap(_ => AppError.Internal("Invalid analysis artifact payload."))
        )
        .flatMap(json =>
          validateDecodedJson(
            json,
            request,
            itemCount,
            sourceMatchRevision,
            depth,
            config,
          ).as(SeriesAnalysisChunk(artifact, request.scope, json))
        )
    }

  def memberIds(json: Json): Either[AppError, List[String]] =
    val ids = mutable.HashSet.empty[String]
    val pending = mutable.ArrayDeque(json)
    while pending.nonEmpty && ids.size <= MaximumMemberCount do
      val current = pending.removeLast()
      val _ = current.arrayOrObject(
        (),
        values => pending.appendAll(values),
        fields =>
          fields("memberId").flatMap(_.asString).foreach { memberId =>
            if memberId.nonEmpty then
              val _ = ids.add(memberId)
          }
          if ids.size <= MaximumMemberCount then pending.appendAll(fields.values),
      )
    Either.cond(
      ids.size <= MaximumMemberCount,
      ids.toList.sorted,
      AppError.Internal("Analysis artifact contains too many member identifiers."),
    )

  def jsonUtf8BytesUpperBound(json: Json): Long =
    val value = json.noSpaces
    @tailrec
    def count(index: Int, bytes: Long): Long =
      if index >= value.length then bytes
      else
        val codePoint = Character.codePointAt(value, index)
        val width = if codePoint <= 0x7f then 1L
        else if codePoint <= 0x7ff then 2L
        else if codePoint <= 0xffff then 3L
        else 4L
        count(index + Character.charCount(codePoint), bytes + width)
    count(0, 0L)

  def hydratePayload(
      chunk: SeriesAnalysisChunk,
      names: Map[String, String],
      scopeName: String,
  ): Json =
    val memberHydrated = hydrateMemberObjects(chunk.payload, names)
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

  def includedContext(
      chunk: SeriesAnalysisChunk,
      sourceMatchRevision: Long,
  ): SeriesAnalysisChunk = chunk.copy(payload =
    chunk.payload.mapObject(_.add(
      "inclusion",
      Json.obj(
        "status" -> Json.fromString("included"),
        "sourceMatchRevision" -> Json.fromString(sourceMatchRevision.toString),
      ),
    ))
  )

  def excludedContext(
      artifact: SeriesAnalysisArtifactRef,
      scope: SeriesAnalysisScope,
      matchId: MatchId,
      status: String,
  ): SeriesAnalysisChunk = SeriesAnalysisChunk(
    artifact,
    scope,
    Json.obj(
      "schemaVersion" -> Json.fromInt(1),
      "artifact" -> artifactJson(artifact),
      "scope" -> scopeJson(scope),
      "matchId" -> Json.fromString(matchId.value),
      "inclusion" -> Json.obj("status" -> Json.fromString(status)),
      "match" -> Json.Null,
    ),
  )

  private def decodeUtf8(payload: Array[Byte]): Either[AppError, String] = Try(
    StandardCharsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(payload)).toString
  ).toEither.leftMap(_ => AppError.Internal("Invalid UTF-8 analysis artifact payload."))

  private def jsonTextDepthWithin(value: String, maximumDepth: Int): Boolean =
    @tailrec
    def scan(index: Int, depth: Int, inString: Boolean, escaped: Boolean): Boolean =
      if index >= value.length then !inString && depth == 0
      else
        val character = value.charAt(index)
        if inString then
          if escaped then scan(index + 1, depth, inString = true, escaped = false)
          else if character == '\\' then scan(index + 1, depth, inString = true, escaped = true)
          else if character == '"' then scan(index + 1, depth, inString = false, escaped = false)
          else scan(index + 1, depth, inString = true, escaped = false)
        else if character == '"' then
          scan(index + 1, depth, inString = true, escaped = false)
        else if character == '{' || character == '[' then
          depth < maximumDepth && scan(index + 1, depth + 1, inString = false, escaped = false)
        else if character == '}' || character == ']' then
          depth > 0 && scan(index + 1, depth - 1, inString = false, escaped = false)
        else scan(index + 1, depth, inString = false, escaped = false)
    scan(0, 0, inString = false, escaped = false)

  private def validateDecodedJson(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
      sourceMatchRevision: Option[Long],
      declaredDepth: Int,
      config: SeriesAnalysisReadConfig,
  ): Either[AppError, Unit] =
    val actualDepth = boundedJsonDepth(json, config.maxNestingDepth)
    val valid = SeriesAnalysisPayloadValidator.validate(
      json,
      request,
      itemCount,
      sourceMatchRevision,
    ) && actualDepth.contains(declaredDepth)
    Either.cond(valid, (), AppError.Internal("Analysis artifact schema validation failed."))

  private def boundedJsonDepth(json: Json, maximumDepth: Int): Option[Int] =
    val pending = mutable.ArrayDeque(json -> 1)
    @tailrec
    def visit(deepest: Int): Option[Int] =
      if pending.isEmpty then Some(deepest)
      else
        val (current, depth) = pending.removeLast()
        if depth > maximumDepth then None
        else
          val _ = current.arrayOrObject(
            (),
            values => values.foreach(value => pending.append(value -> (depth + 1))),
            fields => fields.values.foreach(value => pending.append(value -> (depth + 1))),
          )
          visit(math.max(deepest, depth))
    visit(0)

  private def hydrateMemberObjects(json: Json, names: Map[String, String]): Json = json
    .arrayOrObject(
      json,
      values => Json.fromValues(values.map(hydrateMemberObjects(_, names))),
      fields =>
        val hydrated = fields.mapValues(hydrateMemberObjects(_, names))
        fields("memberId").flatMap(_.asString).flatMap(names.get) match
          case Some(name) => Json.fromJsonObject(hydrated.add("displayName", Json.fromString(name)))
          case None => Json.fromJsonObject(hydrated),
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

end PostgresSeriesAnalysisChunkCodec
