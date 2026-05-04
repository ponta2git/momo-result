package momo.api.repositories.postgres

import java.nio.file.{Path, Paths}

import doobie.Meta

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, MatchDraftStatus, OcrJobStatus, ScreenType}

/**
 * Shared database type mappings for opaque IDs, enums, and other custom types used by the
 * PostgreSQL repositories. Keeping them in one place avoids accidental divergence between repos.
 */
object PostgresMeta:
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

  given Meta[MatchDraftStatus] = Meta[String]
    .tiemap(s => MatchDraftStatus.fromWire(s).toRight(s"unknown match_draft status=$s"))(_.wire)

  given Meta[FailureCode] = Meta[String]
    .tiemap(s => FailureCode.fromWire(s).toRight(s"unknown failure_code=$s"))(_.wire)
