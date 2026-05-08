package momo.api.repositories

import java.nio.file.Path
import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.syntax.all.*
import io.circe.syntax.*
import io.circe.{Json, Printer}

import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.ids.*
import momo.api.domain.{OcrJobHints, ScreenType}

final case class OcrQueuePayload(fields: Map[String, String])

object OcrQueuePayload:
  val RequiredKeys: Set[String] =
    Set("jobId", "draftId", "imageId", "imagePath", "requestedImageType", "attempt", "enqueuedAt")
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
  ): OcrQueuePayload =
    val base = Map(
      "jobId" -> jobId.value,
      "draftId" -> draftId.value,
      "imageId" -> imageId.value,
      "imagePath" -> imagePath.toString,
      "requestedImageType" -> requestedScreenType.wire,
      "attempt" -> attempt.toString,
      "enqueuedAt" -> DateTimeFormatter.ISO_INSTANT.format(enqueuedAt),
    )

    val withHints =
      if hints.isEmpty then base
      else base + (HintsKey -> printer.print(hints.asJson.deepDropNullValues))

    val withRequestId = requestId.filter(_.nonEmpty) match
      case Some(id) => withHints + (RequestIdKey -> id)
      case None => withHints

    OcrQueuePayload(withRequestId)

  def fieldsAsJson(payload: OcrQueuePayload): Json = Json
    .obj(payload.fields.toSeq.sortBy(_._1).map { case (key, value) =>
      key -> Json.fromString(value)
    }*)

  def fromJson(json: Json): Either[String, OcrQueuePayload] = json.asObject
    .toRight("stream payload must be a JSON object").flatMap { obj =>
      obj.toMap.toList.traverse { case (key, value) =>
        value.asString.toRight(s"field $key must be a string").map(key -> _)
      }.map(entries => OcrQueuePayload(entries.toMap))
    }
