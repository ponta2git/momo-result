package momo.api.repositories.postgres

import java.nio.file.{Path, Paths}

import doobie.Meta

import momo.api.domain.ids.*
import momo.api.domain.{FailureCode, MatchDraftStatus, OcrJobStatus, ScreenType}
import momo.api.repositories.OcrQueueOutboxStatus

/**
 * Shared database type mappings for opaque IDs, enums, and other custom types used by the
 * PostgreSQL repositories. Keeping them in one place avoids accidental divergence between repos.
 */
object PostgresMeta:
  given Meta[OcrJobId] = Meta[String].imap(OcrJobId.apply)(_.value)
  given Meta[OcrDraftId] = Meta[String].imap(OcrDraftId.apply)(_.value)
  given Meta[ImageId] = Meta[String].imap(ImageId.apply)(_.value)
  given Meta[MemberId] = Meta[String].imap(MemberId.apply)(_.value)
  given Meta[HeldEventId] = Meta[String].imap(HeldEventId.apply)(_.value)
  given Meta[MatchId] = Meta[String].imap(MatchId.apply)(_.value)
  given Meta[MatchDraftId] = Meta[String].imap(MatchDraftId.apply)(_.value)
  given Meta[GameTitleId] = Meta[String].imap(GameTitleId.apply)(_.value)
  given Meta[MapMasterId] = Meta[String].imap(MapMasterId.apply)(_.value)
  given Meta[SeasonMasterId] = Meta[String].imap(SeasonMasterId.apply)(_.value)
  given Meta[IncidentMasterId] = Meta[String].imap(IncidentMasterId.apply)(_.value)
  given Meta[UserId] = Meta[String].imap(UserId.apply)(_.value)

  given Meta[Path] = Meta[String].imap(Paths.get(_))(_.toString)

  given Meta[ScreenType] = Meta[String]
    .tiemap(s => ScreenType.fromWire(s).toRight(s"unknown screen_type=$s"))(_.wire)

  given Meta[OcrJobStatus] = Meta[String].tiemap(s =>
    OcrJobStatus.values.find(_.wire == s).toRight(s"unknown ocr_job status=$s")
  )(_.wire)

  given Meta[OcrQueueOutboxStatus] = Meta[String].tiemap(s =>
    OcrQueueOutboxStatus.fromWire(s).toRight(s"unknown ocr_queue_outbox status=$s")
  )(_.wire)

  given Meta[MatchDraftStatus] = Meta[String]
    .tiemap(s => MatchDraftStatus.fromWire(s).toRight(s"unknown match_draft status=$s"))(_.wire)

  given Meta[FailureCode] = Meta[String]
    .tiemap(s => FailureCode.fromWire(s).toRight(s"unknown failure_code=$s"))(_.wire)
