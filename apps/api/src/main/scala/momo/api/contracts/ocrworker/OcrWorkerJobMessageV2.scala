package momo.api.contracts.ocrworker

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.syntax.either.*
import io.circe.syntax.*
import io.circe.{Json, Printer}

import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, RequestId, ScreenType}

/** Rust OCR queue contract. It carries only opaque object identity and verified image metadata. */
final class OcrWorkerJobMessageV2 private (
    val jobId: OcrJobId,
    val draftId: OcrDraftId,
    val sourceImageId: ImageId,
    val imageObjectKey: String,
    val sha256: String,
    val byteLength: Long,
    val mediaType: String,
    val requestedScreenType: ScreenType,
    val attempt: Int,
    val enqueuedAt: Instant,
    val hints: OcrJobHints,
    val requestId: Option[String],
):
  def fields: Map[String, String] = OcrWorkerJobMessageV2.toStreamFields(this)

object OcrWorkerJobMessageV2:
  val SchemaVersionKey = "schemaVersion"
  val SchemaVersion = "2"
  val HintsKey = "ocrHintsJson"
  val RequestIdKey = "requestId"
  val MaxByteLength = 3L * 1024L * 1024L
  val MaxIdLength = 128
  val MaxObjectKeyLength = 512
  val MaxHintsUtf8Bytes = 8192

  val RequiredKeys: Set[String] = Set(
    SchemaVersionKey,
    "jobId",
    "draftId",
    "sourceImageId",
    "imageObjectKey",
    "sha256",
    "byteLength",
    "mediaType",
    "requestedScreenType",
    "attempt",
    "enqueuedAt",
  )

  private val AllowedMediaTypes = Set("image/png", "image/jpeg", "image/webp")
  private val ObjectKeyCharacters = "^[A-Za-z0-9][A-Za-z0-9._/-]*$".r
  private val Sha256Pattern = "^[0-9a-f]{64}$".r
  private val printer: Printer = Printer.noSpaces.copy(dropNullValues = true, sortKeys = true)

  def build(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      sourceImageId: ImageId,
      imageObjectKey: String,
      sha256: String,
      byteLength: Long,
      mediaType: String,
      requestedScreenType: ScreenType,
      attempt: Int,
      enqueuedAt: Instant,
      hints: OcrJobHints,
      requestId: Option[String],
  ): Either[String, OcrWorkerJobMessageV2] =
    for
      _ <- validateId("jobId", jobId.value)
      _ <- validateId("draftId", draftId.value)
      _ <- validateId("sourceImageId", sourceImageId.value)
      _ <- validateObjectKey(imageObjectKey)
      _ <- Either.cond(Sha256Pattern.matches(sha256), (), "sha256 must be 64 lowercase hex chars")
      _ <- Either.cond(
        byteLength >= 1L && byteLength <= MaxByteLength,
        (),
        s"byteLength must be between 1 and ${MaxByteLength.toString}",
      )
      _ <- Either.cond(
        AllowedMediaTypes.contains(mediaType),
        (),
        "mediaType must be image/png, image/jpeg, or image/webp",
      )
      _ <- Either.cond(
        requestedScreenType != ScreenType.Auto,
        (),
        "requestedScreenType=auto is not supported by schemaVersion 2",
      )
      _ <- Either.cond(attempt > 0, (), "attempt must be positive")
      _ <- validateHints(hints)
      safeRequestId <- requestId match
        case None => Right(None)
        case Some(value) => RequestId.sanitize(value).toRight(RequestId.Description).map(Some(_))
    yield new OcrWorkerJobMessageV2(
      jobId = jobId,
      draftId = draftId,
      sourceImageId = sourceImageId,
      imageObjectKey = imageObjectKey,
      sha256 = sha256,
      byteLength = byteLength,
      mediaType = mediaType,
      requestedScreenType = requestedScreenType,
      attempt = attempt,
      enqueuedAt = enqueuedAt,
      hints = hints,
      requestId = safeRequestId,
    )

  def toStreamFields(value: OcrWorkerJobMessageV2): Map[String, String] =
    val base = Map(
      SchemaVersionKey -> SchemaVersion,
      "jobId" -> value.jobId.value,
      "draftId" -> value.draftId.value,
      "sourceImageId" -> value.sourceImageId.value,
      "imageObjectKey" -> value.imageObjectKey,
      "sha256" -> value.sha256,
      "byteLength" -> value.byteLength.toString,
      "mediaType" -> value.mediaType,
      "requestedScreenType" -> value.requestedScreenType.wire,
      "attempt" -> value.attempt.toString,
      "enqueuedAt" -> DateTimeFormatter.ISO_INSTANT.format(value.enqueuedAt),
    )
    val withHints =
      if value.hints.isEmpty then base
      else base + (HintsKey -> printer.print(value.hints.asJson.deepDropNullValues))
    value.requestId.fold(withHints)(id => withHints + (RequestIdKey -> id))

  def fieldsAsJson(message: OcrWorkerJobMessageV2): Json = Json
    .obj(message.fields.toSeq.sortBy(_._1).map { case (key, value) =>
      key -> Json.fromString(value)
    }*)

  def fromJson(json: Json): Either[String, OcrWorkerJobMessageV2] = json.asObject
    .toRight("stream payload must be a JSON object").flatMap { obj =>
      val fields = obj.toMap
      val allowed = RequiredKeys + HintsKey + RequestIdKey
      val unknown = fields.keySet.diff(allowed)
      if unknown.nonEmpty then
        Left(s"unknown stream payload field(s): ${unknown.toList.sorted.mkString(",")}")
      else parseRedisFields(fields.map { case (key, value) => key -> value.asString })
    }

  private def parseRedisFields(
      fields: Map[String, Option[String]]
  ): Either[String, OcrWorkerJobMessageV2] =
    def required(key: String): Either[String, String] = fields.get(key).flatten
      .toRight(s"field $key must be a string")

    def optional(key: String): Either[String, Option[String]] = fields.get(key) match
      case None => Right(None)
      case Some(Some(value)) => Right(Some(value))
      case Some(None) => Left(s"field $key must be a string")

    for
      version <- required(SchemaVersionKey)
      _ <- Either.cond(version == SchemaVersion, (), s"schemaVersion must be $SchemaVersion")
      jobId <- required("jobId")
      draftId <- required("draftId")
      sourceImageId <- required("sourceImageId")
      parsedJobId <- OcrJobId.fromString(jobId).leftMap(_ => "jobId must not be blank")
      parsedDraftId <- OcrDraftId.fromString(draftId).leftMap(_ => "draftId must not be blank")
      parsedSourceImageId <- ImageId.fromString(sourceImageId)
        .leftMap(_ => "sourceImageId must not be blank")
      imageObjectKey <- required("imageObjectKey")
      sha256 <- required("sha256")
      byteLength <- required("byteLength").flatMap(value =>
        value.toLongOption.toRight("byteLength must be an integer string")
      )
      mediaType <- required("mediaType")
      requested <- required("requestedScreenType")
      screenType <- ScreenType.fromExplicitWire(requested)
        .toRight(s"unknown requestedScreenType=$requested")
      attempt <- required("attempt").flatMap(value =>
        value.toIntOption.toRight("attempt must be an integer string")
      )
      enqueuedAt <- required("enqueuedAt").flatMap(value =>
        Either.catchNonFatal(Instant.parse(value)).left.map(_ => "enqueuedAt must be ISO-8601")
      )
      hintsJson <- optional(HintsKey)
      hints <- hintsJson match
        case None => Right(OcrJobHints.empty)
        case Some(raw) => io.circe.parser.decode[OcrJobHints](raw).left.map(_.getMessage)
      requestId <- optional(RequestIdKey)
      message <- build(
        jobId = parsedJobId,
        draftId = parsedDraftId,
        sourceImageId = parsedSourceImageId,
        imageObjectKey = imageObjectKey,
        sha256 = sha256,
        byteLength = byteLength,
        mediaType = mediaType,
        requestedScreenType = screenType,
        attempt = attempt,
        enqueuedAt = enqueuedAt,
        hints = hints,
        requestId = requestId,
      )
    yield message

  private def validateObjectKey(value: String): Either[String, Unit] =
    val segments = value.split("/", -1).toList
    val valid = value.nonEmpty && value.length <= MaxObjectKeyLength &&
      ObjectKeyCharacters.matches(value) &&
      segments.forall(segment => segment.nonEmpty && segment != "." && segment != "..")
    Either.cond(
      valid,
      (),
      "imageObjectKey must be a safe opaque relative key without empty, dot, or parent segments",
    )

  private def validateId(name: String, value: String): Either[String, Unit] = Either.cond(
    value.nonEmpty && value.length <= MaxIdLength && value.forall(character =>
      character >= 0x21 && character <= 0x7e
    ),
    (),
    s"$name must be 1-$MaxIdLength printable ASCII characters",
  )

  private def validateHints(hints: OcrJobHints): Either[String, Unit] =
    val encoded = printer.print(hints.asJson.deepDropNullValues).getBytes(StandardCharsets.UTF_8)
    val errors = OcrJobHints.validationErrors(hints)
    if errors.nonEmpty then Left(errors.mkString(" "))
    else if encoded.length > MaxHintsUtf8Bytes then
      Left(s"ocrHintsJson must be $MaxHintsUtf8Bytes UTF-8 bytes or shorter")
    else Right(())
