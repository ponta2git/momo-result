package momo.api.repositories.postgres

import cats.MonadThrow
import cats.data.EitherT
import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.domain.{MatchDraftStatus, OcrDraft, OcrJob, OcrJobStatus, ScreenType}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.OcrJobCreationRepository.CreateQueuedJobRejection
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{OcrJobCreationRepository, OcrJobDraftAttachment, OcrQueueOutboxDraft}

final class PostgresOcrJobCreationRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrJobCreationRepository[F]:

  override def createQueuedJob(
      draft: OcrDraft,
      job: OcrJob,
      attachment: Option[OcrJobDraftAttachment],
      enqueueRequest: OcrJobEnqueueRequest,
      activeJobLimit: Int,
  ): F[OcrJobCreationRepository.CreateQueuedJobResult] =
    val outbox = OcrQueueOutboxDraft.forJob(job.id, enqueueRequest, job.createdAt)
    val program =
      for
        _ <- EitherT(activeLimitGuard(activeJobLimit))
        _ <- attachment match
          case None => EitherT.rightT[ConnectionIO, CreateQueuedJobRejection](())
          case Some(a) => EitherT(attachmentGuard(a))
        _ <- EitherT.liftF(PostgresOcrDrafts.alg.create(draft))
        _ <- EitherT.liftF(PostgresOcrJobs.alg.create(job))
        _ <- EitherT.liftF(attachment.traverse_(attachMatchDraft))
        _ <- EitherT.liftF(PostgresOcrQueueOutbox.insertIntent(outbox))
      yield ()
    program.value.transact(transactor)

  private def activeLimitGuard(
      activeJobLimit: Int
  ): ConnectionIO[Either[CreateQueuedJobRejection, Unit]] = sql"""
        WITH active_limit_lock AS (
          SELECT pg_advisory_xact_lock(hashtext('momo:ocr_jobs:active_limit')::bigint)
        )
        SELECT COUNT(*)
        FROM ocr_jobs, active_limit_lock
        WHERE status = ${OcrJobStatus.Queued}
           OR status = ${OcrJobStatus.Running}
      """.query[Long].unique.flatMap { active =>
    if active >= activeJobLimit.toLong then
      CreateQueuedJobRejection.ActiveJobLimitExceeded(activeJobLimit).asLeft.pure[ConnectionIO]
    else ().asRight[CreateQueuedJobRejection].pure[ConnectionIO]
  }

  private def attachmentGuard(
      attachment: OcrJobDraftAttachment
  ): ConnectionIO[Either[CreateQueuedJobRejection, Unit]] = slotDraftColumn(
    attachment.screenType
  ) match
    case None => CreateQueuedJobRejection.MatchDraftAttachFailed(attachment.draftId).asLeft
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
        case None => CreateQueuedJobRejection.MatchDraftAttachFailed(attachment.draftId).asLeft
      }

  private def attachMatchDraft(attachment: OcrJobDraftAttachment): ConnectionIO[Unit] =
    PostgresMatchDrafts.alg.attachOcrArtifacts(
      draftId = attachment.draftId,
      screenType = attachment.screenType,
      sourceImageId = attachment.sourceImageId,
      ocrDraftId = attachment.ocrDraftId,
      updatedAt = attachment.updatedAt,
    ).flatMap {
      case true => MonadThrow[ConnectionIO].unit
      case false => MonadThrow[ConnectionIO].raiseError(AppException(AppError.Internal(
          "match draft OCR attachment was rejected after preflight."
        )))
    }

  private def slotDraftColumn(screenType: ScreenType): Option[Fragment] = screenType match
    case ScreenType.TotalAssets => Some(Fragment.const("match_drafts.total_assets_draft_id"))
    case ScreenType.Revenue => Some(Fragment.const("match_drafts.revenue_draft_id"))
    case ScreenType.IncidentLog => Some(Fragment.const("match_drafts.incident_log_draft_id"))
    case ScreenType.Auto => None
