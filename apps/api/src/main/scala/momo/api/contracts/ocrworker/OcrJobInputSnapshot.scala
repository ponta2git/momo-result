package momo.api.contracts.ocrworker


import cats.syntax.either.*
import io.circe.Json

import momo.api.codec.OcrHintsCodec
import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.ids.*
import momo.api.domain.{
  OcrJobHints,
  OcrJobInput,
  RequestId,
  ScreenType,
  StoredImageLocation
}

/** Immutable OCR input saved with its job. Values preserve the accepted image and hints. */
final class OcrJobInputSnapshot private (
    val jobId: OcrJobId,
    val draftId: OcrDraftId,
    val sourceImageId: ImageId,
    val imageObjectKey: String,
    val sha256: String,
    val byteLength: Long,
    val mediaType: String,
    val requestedScreenType: ScreenType,
    val hints: OcrJobHints,
    val requestId: Option[String],
):
  def fields: Map[String, String] = OcrJobInputSnapshot.snapshotFields(this)

  def toInput: Either[String, OcrJobInput] =
    StoredImageLocation.fromString(imageObjectKey).map(location =>
      OcrJobInput(
        jobId = jobId,
        draftId = draftId,
        imageId = sourceImageId,
        imageLocation = location,
        imageSha256 = sha256,
        imageByteLength = byteLength,
        imageMediaType = mediaType,
        requestedScreenType = requestedScreenType,
        hints = hints,
        requestId = requestId,
      )
    )

object OcrJobInputSnapshot:
  val SchemaVersionKey = "schemaVersion"
  val SchemaVersion = "2"
  val HintsKey = "ocrHintsJson"
  val RequestIdKey = "requestId"
  val MaxByteLength = 3L * 1024L * 1024L
  val MaxIdLength = 128
  val MaxObjectKeyLength = 512
  val MaxHintsUtf8Bytes = OcrHintsCodec.MaxUtf8Bytes

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
  )

  private val AllowedMediaTypes = Set("image/png", "image/jpeg", "image/webp")
  private val ObjectKeyCharacters = "^[A-Za-z0-9][A-Za-z0-9._/-]*$".r
  private val Sha256Pattern = "^[0-9a-f]{64}$".r

  def fromInput(
      request: OcrJobInput
  ): Either[String, OcrJobInputSnapshot] = build(
    jobId = request.jobId,
    draftId = request.draftId,
    sourceImageId = request.imageId,
    imageObjectKey = request.imageLocation.value,
    sha256 = request.imageSha256,
    byteLength = request.imageByteLength,
    mediaType = request.imageMediaType,
    requestedScreenType = request.requestedScreenType,
    hints = request.hints,
    requestId = request.requestId,
  )

  def build(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      sourceImageId: ImageId,
      imageObjectKey: String,
      sha256: String,
      byteLength: Long,
      mediaType: String,
      requestedScreenType: ScreenType,
      hints: OcrJobHints,
      requestId: Option[String],
  ): Either[String, OcrJobInputSnapshot] =
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
      _ <- OcrHintsCodec.validate(hints)
      safeRequestId <- requestId match
        case None => Right(None)
        case Some(value) => RequestId.sanitize(value).toRight(RequestId.Description).map(Some(_))
    yield new OcrJobInputSnapshot(
      jobId = jobId,
      draftId = draftId,
      sourceImageId = sourceImageId,
      imageObjectKey = imageObjectKey,
      sha256 = sha256,
      byteLength = byteLength,
      mediaType = mediaType,
      requestedScreenType = requestedScreenType,
      hints = hints,
      requestId = safeRequestId,
    )

  def snapshotFields(value: OcrJobInputSnapshot): Map[String, String] =
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
    )
    val withHints =
      if value.hints.isEmpty then base
      else base + (HintsKey -> OcrHintsCodec.encode(value.hints))
    value.requestId.fold(withHints)(id => withHints + (RequestIdKey -> id))

  def toJson(message: OcrJobInputSnapshot): Json = Json
    .obj(message.fields.toSeq.sortBy(_._1).map { case (key, value) =>
      key -> Json.fromString(value)
    }*)

  def fromJson(json: Json): Either[String, OcrJobInputSnapshot] = json.asObject
    .toRight("input snapshot must be a JSON object").flatMap { obj =>
      val fields = obj.toMap
      val allowed = RequiredKeys + HintsKey + RequestIdKey
      val unknown = fields.keySet.diff(allowed)
      if unknown.nonEmpty then
        Left(s"unknown input snapshot field(s): ${unknown.toList.sorted.mkString(",")}")
      else parseSnapshotFields(fields.map { case (key, value) => key -> value.asString })
    }

  private def parseSnapshotFields(
      fields: Map[String, Option[String]]
  ): Either[String, OcrJobInputSnapshot] =
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
