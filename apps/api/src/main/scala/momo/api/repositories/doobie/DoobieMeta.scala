package momo.api.repositories.doobie

import doobie.Meta
import doobie.postgres.implicits.*
import momo.api.domain.FailureCode
import momo.api.domain.OcrJobStatus
import momo.api.domain.ScreenType
import momo.api.domain.ids.*

import java.nio.file.Path
import java.nio.file.Paths

/** Shared `Meta` instances for opaque IDs, enums, and other custom types
  * used by the Doobie repositories. Keeping them in one place avoids
  * accidental divergence between repos.
  */
object DoobieMeta:
  given Meta[JobId] = Meta[String].imap(JobId.apply)(_.value)
  given Meta[DraftId] = Meta[String].imap(DraftId.apply)(_.value)
  given Meta[ImageId] = Meta[String].imap(ImageId.apply)(_.value)
  given Meta[MemberId] = Meta[String].imap(MemberId.apply)(_.value)

  given Meta[Path] = Meta[String].imap(Paths.get(_))(_.toString)

  given Meta[ScreenType] = Meta[String].timap(s =>
    ScreenType.fromWire(s).getOrElse(throw new IllegalStateException(s"unknown screen_type=$s"))
  )(_.wire)

  given Meta[OcrJobStatus] = Meta[String].timap { s =>
    OcrJobStatus.values.find(_.wire == s) match
      case Some(v) => v
      case None    => throw new IllegalStateException(s"unknown ocr_job status=$s")
  }(_.wire)

  given Meta[FailureCode] = Meta[String].timap(s =>
    FailureCode
      .fromWire(s)
      .getOrElse(throw new IllegalStateException(s"unknown failure_code=$s"))
  )(_.wire)
