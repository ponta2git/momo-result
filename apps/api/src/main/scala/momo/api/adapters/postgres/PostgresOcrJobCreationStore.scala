package momo.api.adapters.postgres

import cats.MonadThrow
import cats.data.EitherT
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.{MatchDraftStatus, OcrJobStatus, ScreenType}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  MatchDraftAttachmentResult,
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  OcrQueueOutboxDraft
}

final class PostgresOcrJobCreationStore[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobCreationStore[F]:

  override def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult] =
    val attachment = plan.matchDraftAttachment
    val dispatch = plan.queueDispatch
    val outbox =
      OcrQueueOutboxDraft.forJob(dispatch.jobId, dispatch.enqueueRequest, dispatch.createdAt)
    val program =
      for
        _ <- EitherT(activeLimitGuard(plan.activeJobLimit))
        _ <- attachment match
          case None => EitherT.rightT[ConnectionIO, OcrJobCreationRejection](())
          case Some(a) => EitherT(attachmentGuard(a))
        _ <- EitherT.liftF(PostgresOcrDrafts.alg.create(plan.draft))
        _ <- EitherT.liftF(PostgresOcrJobs.createV2(plan.job))
        _ <- EitherT.liftF(attachment.traverse_(attachMatchDraft))
        _ <- EitherT.liftF(PostgresOcrQueueOutbox.insertIntent(outbox))
      yield ()
    program.value.transact(transactor)

  private def activeLimitGuard(
      activeJobLimit: Int
  ): ConnectionIO[Either[OcrJobCreationRejection, Unit]] = sql"""
        WITH active_limit_lock AS (
          SELECT pg_advisory_xact_lock(hashtext('momo:ocr_jobs:active_limit')::bigint)
        )
        SELECT COUNT(*)
        FROM ocr_jobs, active_limit_lock
        WHERE status = ${OcrJobStatus.Queued}
           OR status = ${OcrJobStatus.Running}
      """.query[Long].unique.flatMap { active =>
    if active >= activeJobLimit.toLong then
      OcrJobCreationRejection.ActiveJobLimitExceeded(activeJobLimit).asLeft.pure[ConnectionIO]
    else ().asRight[OcrJobCreationRejection].pure[ConnectionIO]
  }

  private def attachmentGuard(
      attachment: OcrJobDraftAttachment
  ): ConnectionIO[Either[OcrJobCreationRejection, Unit]] = slotDraftColumn(
    attachment.screenType
  ) match
    case None => OcrJobCreationRejection.MatchDraftAttachmentRejected(attachment.draftId).asLeft
        .pure[ConnectionIO]
    case Some(slotDraftColumn) =>
      val query =
        fr"""
        SELECT 1
        FROM match_drafts
        WHERE id = ${attachment.draftId}
          AND status <> ${MatchDraftStatus.Confirmed}
          AND status <> ${MatchDraftStatus.Cancelled}
          AND (
      """ ++ slotDraftColumn ++ fr""" IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM ocr_jobs existing
            WHERE existing.draft_id = """ ++ slotDraftColumn ++ fr"""
              AND existing.status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
          )
        )
        FOR UPDATE
      """
      query.query[Int].option.map {
        case Some(_) => ().asRight
        case None =>
          OcrJobCreationRejection.MatchDraftAttachmentRejected(attachment.draftId).asLeft
      }

  private def attachMatchDraft(attachment: OcrJobDraftAttachment): ConnectionIO[Unit] =
    PostgresMatchDrafts.alg.attachOcrArtifacts(
      draftId = attachment.draftId,
      screenType = attachment.screenType,
      sourceImageId = attachment.sourceImageId,
      ocrDraftId = attachment.ocrDraftId,
      updatedAt = attachment.updatedAt,
    ).flatMap {
      case MatchDraftAttachmentResult.Attached => MonadThrow[ConnectionIO].unit
      case MatchDraftAttachmentResult.NotAttachable =>
        MonadThrow[ConnectionIO].raiseError(AppException(AppError.Internal(
          "match draft OCR attachment was rejected after preflight."
        )))
    }

  private def slotDraftColumn(screenType: ScreenType): Option[Fragment] = screenType match
    case ScreenType.TotalAssets => Some(fr"match_drafts.total_assets_draft_id")
    case ScreenType.Revenue => Some(fr"match_drafts.revenue_draft_id")
    case ScreenType.IncidentLog => Some(fr"match_drafts.incident_log_draft_id")
    case ScreenType.Auto => None
