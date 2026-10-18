package momo.api.adapters.postgres

import cats.MonadThrow
import cats.data.EitherT
import cats.effect.Async
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.{MatchDraftStatus, OcrJobStatus, OcrSubmissionMember, ScreenType}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectKey}
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.repositories.{
  MatchDraftAttachmentResult,
  OcrJobAcceptance,
  OcrJobCreationPlan,
  OcrJobCreationStore,
  OcrJobDraftAttachment,
  SourceImageStatus,
  StoredOcrJob
}

final class PostgresOcrJobCreationStore[F[_]: Async](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy
) extends OcrJobCreationStore[F]:
  private given ids: PostgresIdentities = identities
  private final case class SourceImageGuardRow(
      owner: momo.api.domain.ids.AccountId,
      idempotencyHash: String,
      status: SourceImageStatus,
      objectKey: SourceImageObjectKey,
      sha256: Option[Sha256Hex],
      byteLength: Option[Long],
      mediaType: Option[String],
  )

  override def store(plan: OcrJobCreationPlan): F[OcrJobCreationStore.OcrJobCreationResult] =
    val attachment = plan.matchDraftAttachment
    val program =
      for
        draftOwner <-
          sql"SELECT ${ids.wireReference(Entity.Accounts, fr"match_drafts.created_by_account_id")} FROM match_drafts WHERE id = ${ids.lookup(Entity.MatchDrafts, attachment.draftId.value)} FOR UPDATE"
            .query[momo.api.domain.ids.AccountId].option
        _ <- PostgresOcrSubmissions.lock(plan.submission.submissionId)
        submission <- PostgresOcrSubmissions.read(plan.submission.submissionId)
        member = submission.flatMap(_.members.find(_.screenType == attachment.screenType))
        existing <- member.flatMap(_.jobId).traverse(PostgresOcrJobs.alg.findAcceptance)
          .map(_.flatten.map(StoredOcrJob(_, false)))
        result <-
          if !OcrJobCreationPlan.isConsistent(plan) then
            OcrJobCreationRejection.InvalidPlan.asLeft[StoredOcrJob].pure[ConnectionIO]
          else if !submission.exists(s =>
              s.ownerAccountId == plan.submission.ownerAccountId &&
                s.matchDraftId == attachment.draftId
            )
          then
            OcrJobCreationRejection.SubmissionRejected.asLeft[StoredOcrJob].pure[ConnectionIO]
          else
            existing match
              case Some(saved) if saved.job.imageId == plan.job.imageId =>
                saved.asRight[OcrJobCreationRejection].pure[ConnectionIO]
              case Some(_) =>
                OcrJobCreationRejection.SubmissionRejected.asLeft[StoredOcrJob].pure[ConnectionIO]
              case None =>
                (for
                  _ <- EitherT.cond[ConnectionIO](
                    draftOwner.contains(plan.submission.ownerAccountId) &&
                      submission.exists(_.status == "open") && member.exists(_.status == "pending"),
                    (),
                    OcrJobCreationRejection.SubmissionRejected,
                  )
                  _ <- EitherT(attachmentGuard(attachment))
                  _ <- EitherT(sourceImageGuard(plan, member))
                  // Unrelated creators must not hold this global gate while waiting for a draft,
                  // submission, or image. Replays never consume an admission slot.
                  _ <- EitherT.liftF(sql"""
                    SELECT pg_advisory_xact_lock(hashtext('momo:ocr_jobs:active_limit')::bigint)
                  """.query[Unit].unique)
                  // The gate wait may cross the admission deadline. Both time and active count
                  // must be read only after the wait, in fresh READ COMMITTED statements.
                  currentTime <-
                    EitherT.liftF(sql"SELECT clock_timestamp()".query[java.time.Instant].unique)
                  _ <- EitherT.cond[ConnectionIO](
                    draftOwner.contains(plan.submission.ownerAccountId) &&
                      submission.exists(_.canAdmit(attachment.screenType, currentTime)),
                    (),
                    OcrJobCreationRejection.SubmissionRejected
                  )
                  _ <- EitherT(activeLimitGuard(plan.activeJobLimit))
                  _ <- EitherT.liftF(PostgresOcrDrafts.alg.create(plan.draft))
                  _ <- EitherT.liftF(PostgresOcrJobs.create(plan.job, plan.input))
                  _ <- EitherT.liftF(attachMatchDraft(attachment))
                  _ <- EitherT.liftF(sql"""UPDATE ocr_submission_members
                SET status = 'registered', job_id = ${ids.lookup(Entity.OcrJobs, plan.job.id.value)}
                WHERE submission_id = ${ids.lookup(
                      Entity.OcrSubmissions,
                      plan.submission.submissionId
                    )}
                  AND screen_type = ${attachment.screenType} AND status = 'pending'""".update.run)
                yield StoredOcrJob(OcrJobAcceptance.fromJob(plan.job), true)).value
      yield result
    program.transact(transactor)

  private def sourceImageGuard(
      plan: OcrJobCreationPlan,
      member: Option[OcrSubmissionMember],
  ): ConnectionIO[Either[OcrJobCreationRejection, Unit]] =
    sql"""
      SELECT ${ids.wireReference(
        Entity.Accounts,
        fr"source_images.owner_account_id"
      )}, idempotency_key_hash, status, object_key, sha256_hex, byte_length::bigint, media_type
      FROM source_images
      WHERE id = ${ids.lookup(Entity.SourceImages, plan.job.imageId.value)}
      FOR UPDATE
    """.query[SourceImageGuardRow].option.flatMap {
      case Some(row) =>
        val matchesMember = member.exists(m =>
          row.owner == plan.submission.ownerAccountId &&
            row.idempotencyHash == m.uploadIdempotencyKeyHash &&
            row.sha256.exists(_.value == m.imageSha256) &&
            row.byteLength.contains(m.imageByteLength.toLong)
        )
        val result: Either[OcrJobCreationRejection, Unit] =
          if !matchesMember then Left(OcrJobCreationRejection.SubmissionRejected)
          else
            row match
              case SourceImageGuardRow(
                    _,
                    _,
                    SourceImageStatus.Available,
                    objectKey,
                    Some(sha256),
                    Some(byteLength),
                    Some(mediaType),
                  ) if sourceMetadataMatches(plan, objectKey, sha256, byteLength, mediaType) =>
                Right(())
              case SourceImageGuardRow(_, _, SourceImageStatus.Available, _, _, _, _) =>
                Left(OcrJobCreationRejection.InvalidPlan)
              case _ => Left(OcrJobCreationRejection.SourceImageUnavailable(plan.job.imageId))
        result.pure[ConnectionIO]
      case None =>
        Left(OcrJobCreationRejection.SourceImageUnavailable(plan.job.imageId)).pure[ConnectionIO]
    }

  private def sourceMetadataMatches(
      plan: OcrJobCreationPlan,
      objectKey: SourceImageObjectKey,
      sha256: Sha256Hex,
      byteLength: Long,
      mediaType: String,
  ): Boolean =
    val request = plan.input
    plan.job.imageLocation.value == objectKey.value &&
    request.imageLocation.value == objectKey.value &&
    request.imageSha256 == sha256.value &&
    request.imageByteLength == byteLength &&
    request.imageMediaType == mediaType

  private def activeLimitGuard(
      activeJobLimit: Int
  ): ConnectionIO[Either[OcrJobCreationRejection, Unit]] =
    // READ COMMITTED takes a snapshot per statement. Count only after acquiring the lock,
    // so a creator that waited sees the preceding creator's committed job.
    sql"""
        SELECT COUNT(*)
        FROM ocr_jobs
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
        WHERE id = ${ids.lookup(Entity.MatchDrafts, attachment.draftId.value)}
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
