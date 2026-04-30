package momo.api.adapters

import io.circe.{Json, Printer}
import io.circe.syntax.*
import java.nio.file.Path
import java.time.format.DateTimeFormatter
import java.time.Instant
import momo.api.domain.{OcrJobHints, ScreenType}
import momo.api.domain.ids.*

final case class OcrStreamPayload(fields: Map[String, String])

object OcrStreamPayload:
  val RequiredKeys: Set[String] =
    Set("jobId", "draftId", "imageId", "imagePath", "requestedImageType", "attempt", "enqueuedAt")
  val HintsKey = "ocrHintsJson"

  private val printer: Printer = Printer.noSpaces.copy(dropNullValues = true, sortKeys = true)

  def build(
      jobId: JobId,
      draftId: DraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      attempt: Int,
      enqueuedAt: Instant,
      hints: OcrJobHints,
  ): OcrStreamPayload =
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

    OcrStreamPayload(withHints)

  def fieldsAsJson(payload: OcrStreamPayload): Json = Json
    .obj(payload.fields.toSeq.sortBy(_._1).map { case (key, value) =>
      key -> Json.fromString(value)
    }*)
