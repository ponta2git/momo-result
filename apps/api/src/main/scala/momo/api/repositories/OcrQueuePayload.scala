package momo.api.repositories

import java.nio.file.Path
import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.syntax.either.*
import io.circe.syntax.*
import io.circe.{Json, Printer}

import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, RequestId, ScreenType}

final case class OcrQueuePayloadV1(
    jobId: OcrJobId,
    draftId: OcrDraftId,
    imageId: ImageId,
    imagePath: Path,
    requestedScreenType: ScreenType,
    attempt: Int,
    enqueuedAt: Instant,
    hints: OcrJobHints,
    requestId: Option[String],
)

final case class OcrQueuePayload(value: OcrQueuePayloadV1):
  def fields: Map[String, String] = OcrQueuePayload.toRedisFields(value)

object OcrQueuePayload:
  val SchemaVersionKey = "schemaVersion"
  val SchemaVersion = "1"
  val RequiredKeys: Set[String] = Set(
    SchemaVersionKey,
    "jobId",
    "draftId",
    "imageId",
    "imagePath",
    "requestedScreenType",
    "attempt",
    "enqueuedAt",
  )
  val HintsKey = "ocrHintsJson"
  val RequestIdKey = "requestId"

  private val printer: Printer = Printer.noSpaces.copy(dropNullValues = true, sortKeys = true)

  def build(
      jobId: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      attempt: Int,
      enqueuedAt: Instant,
      hints: OcrJobHints,
      requestId: Option[String],
  ): OcrQueuePayload = OcrQueuePayload(OcrQueuePayloadV1(
    jobId = jobId,
    draftId = draftId,
    imageId = imageId,
    imagePath = imagePath,
    requestedScreenType = requestedScreenType,
    attempt = attempt,
    enqueuedAt = enqueuedAt,
    hints = hints,
    requestId = requestId,
  ))

  def toRedisFields(value: OcrQueuePayloadV1): Map[String, String] =
    val base = Map(
      SchemaVersionKey -> SchemaVersion,
      "jobId" -> value.jobId.value,
      "draftId" -> value.draftId.value,
      "imageId" -> value.imageId.value,
      "imagePath" -> value.imagePath.toString,
      "requestedScreenType" -> value.requestedScreenType.wire,
      "attempt" -> value.attempt.toString,
      "enqueuedAt" -> DateTimeFormatter.ISO_INSTANT.format(value.enqueuedAt),
    )

    val withHints =
      if value.hints.isEmpty then base
      else base + (HintsKey -> printer.print(value.hints.asJson.deepDropNullValues))

    value.requestId.flatMap(RequestId.sanitize) match
      case Some(id) => withHints + (RequestIdKey -> id)
      case None => withHints

  def fieldsAsJson(payload: OcrQueuePayload): Json = Json
    .obj(payload.fields.toSeq.sortBy(_._1).map { case (key, value) =>
      key -> Json.fromString(value)
    }*)

  def fromJson(json: Json): Either[String, OcrQueuePayload] = json.asObject
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
  ): Either[String, OcrQueuePayload] =
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
      imageId <- required("imageId")
      parsedJobId <- OcrJobId.fromString(jobId).leftMap(_ => "jobId must not be blank")
      parsedDraftId <- OcrDraftId.fromString(draftId).leftMap(_ => "draftId must not be blank")
      parsedImageId <- ImageId.fromString(imageId).leftMap(_ => "imageId must not be blank")
      imagePath <- required("imagePath")
      parsedImagePath <- Either.catchNonFatal(java.nio.file.Paths.get(imagePath)).left
        .map(_ => "imagePath must be a valid path")
      _ <- Either.cond(parsedImagePath.isAbsolute, (), "imagePath must be an absolute path")
      requested <- required("requestedScreenType")
      screenType <- ScreenType.fromWire(requested)
        .toRight(s"unknown requestedScreenType=$requested")
      attemptValue <- required("attempt").flatMap(value =>
        value.toIntOption.filter(_ > 0).toRight("attempt must be a positive integer string")
      )
      enqueuedAt <- required("enqueuedAt").flatMap(value =>
        Either.catchNonFatal(Instant.parse(value)).left.map(_ => "enqueuedAt must be ISO-8601")
      )
      hintsJson <- optional(HintsKey)
      requestId <- optional(RequestIdKey).flatMap {
        case None => Right(None)
        case Some(value) => RequestId.sanitize(value).toRight(RequestId.Description).map(Some(_))
      }
      hints <- hintsJson match
        case None => Right(OcrJobHints.empty)
        case Some(raw) => io.circe.parser.decode[OcrJobHints](raw).left.map(_.getMessage)
      _ <- OcrJobHints.validationErrors(hints) match
        case Nil => Right(())
        case errors => Left(errors.mkString(" "))
    yield OcrQueuePayload(OcrQueuePayloadV1(
      jobId = parsedJobId,
      draftId = parsedDraftId,
      imageId = parsedImageId,
      imagePath = parsedImagePath,
      requestedScreenType = screenType,
      attempt = attemptValue,
      enqueuedAt = enqueuedAt,
      hints = hints,
      requestId = requestId,
    ))
