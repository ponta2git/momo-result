package momo.api.repositories.doobie

import doobie.Meta
import java.nio.file.{Path, Paths}
import momo.api.domain.{FailureCode, OcrJobStatus, ScreenType}
import momo.api.domain.ids.*

/**
 * Shared `Meta` instances for opaque IDs, enums, and other custom types used by the Doobie
 * repositories. Keeping them in one place avoids accidental divergence between repos.
 */
object DoobieMeta:
  given Meta[JobId] = Meta[String].imap(JobId.apply)(_.value)
  given Meta[DraftId] = Meta[String].imap(DraftId.apply)(_.value)
  given Meta[ImageId] = Meta[String].imap(ImageId.apply)(_.value)
  given Meta[MemberId] = Meta[String].imap(MemberId.apply)(_.value)

  given Meta[Path] = Meta[String].imap(Paths.get(_))(_.toString)

  given Meta[ScreenType] = Meta[String]
    .tiemap(s => ScreenType.fromWire(s).toRight(s"unknown screen_type=$s"))(_.wire)

  given Meta[OcrJobStatus] = Meta[String].tiemap(s =>
    OcrJobStatus.values.find(_.wire == s).toRight(s"unknown ocr_job status=$s")
  )(_.wire)

  given Meta[FailureCode] = Meta[String]
    .tiemap(s => FailureCode.fromWire(s).toRight(s"unknown failure_code=$s"))(_.wire)
