package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.parser.decode

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.codec.OcrHintsCodec
import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.OcrSubmissionsRepository

final class PostgresOcrSubmissionsRepository[F[_]: Async](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy
) extends OcrSubmissionsRepository[F]:
  private given ids: PostgresIdentities = identities
  import PostgresOcrSubmissions.*

  override def find(id: String, owner: AccountId): F[Option[OcrSubmission]] =
    sql"""SELECT ${ids.wireId("ocr_submissions")} FROM ocr_submissions WHERE id = ${ids.lookup(
        Entity.OcrSubmissions,
        id
      )} AND owner_account_id = ${ids.lookup(Entity.Accounts, owner.value)}
      FOR SHARE""".query[String].option.flatMap {
      case None => Option.empty[OcrSubmission].pure[ConnectionIO]
      case Some(_) => read(id)
    }.transact(transactor)

  override def put(submission: OcrSubmission): F[Either[AppError, OcrSubmission]] =
    val program =
      for
        // Even an operation whose uploads have not started consumes a bounded admission slot.
        _ <- sql"SELECT pg_advisory_xact_lock(hashtext(${submission.ownerAccountId.value}), 2)"
          .query[Unit].unique
        _ <- sql"SELECT pg_advisory_xact_lock(hashtext(${submission.id}), 3)".query[Unit].unique
        // Replays read header and members while terminal/admission writers cannot interleave.
        _ <-
          sql"SELECT ${ids.wireId("ocr_submissions")} FROM ocr_submissions WHERE id = ${ids.lookup(Entity.OcrSubmissions, submission.id)} FOR SHARE"
            .query[String].option
        existing <- read(submission.id)
        result <- existing match
          case Some(saved) =>
            if saved.sameRequest(submission) then Right(saved).pure[ConnectionIO]
            else
              Left(
                AppError.Conflict("This submissionId belongs to another request.")
              ).pure[ConnectionIO]
          case None => admit(submission)
      yield result
    program.transact(transactor)

  private def admit(submission: OcrSubmission): ConnectionIO[Either[AppError, OcrSubmission]] =
    val imageKeys = submission.members.map(_.uploadIdempotencyKeyHash).toArray
    for
      draft <-
        sql"""SELECT status, ${ids.wireReference(
            Entity.Accounts,
            fr"match_drafts.created_by_account_id"
          )} FROM match_drafts WHERE id = ${ids.lookup(
            Entity.MatchDrafts,
            submission.matchDraftId.value
          )} FOR UPDATE"""
          .query[(String, AccountId)].option
      count <- sql"""SELECT COUNT(*) FROM ocr_submissions
      WHERE owner_account_id = ${ids.lookup(
          Entity.Accounts,
          submission.ownerAccountId.value
        )} AND status = 'open'""".query[Long].unique
      result <-
        if draft.isEmpty then
          Left(AppError.NotFound("match draft", submission.matchDraftId.value)).pure[ConnectionIO]
        else if !draft.exists(_._2 == submission.ownerAccountId) then
          Left(
            AppError.Forbidden("Only the creator can add OCR to this match draft.")
          ).pure[ConnectionIO]
        else if !draft.exists { case (status, _) => status != "confirmed" && status != "cancelled" }
        then
          Left(AppError.Conflict("The match draft cannot accept OCR.")).pure[ConnectionIO]
        else if count >= OcrSubmissionsRepository.OpenLimit then
          Left(AppError.TooManyRequests(
            "Too many unfinished OCR submissions. Retry after they finish."
          )).pure[ConnectionIO]
        else
          for
            // Match terminal draft cleanup's image-ID lock order. Missing rows are expected:
            // submission admission precedes upload. A purge claim cannot be reused for upload,
            // even when stale, because its previous owner may still delete the same object.
            images <- sql"""SELECT status, delete_pending_at FROM source_images
              WHERE owner_account_id = ${ids.lookup(
                Entity.Accounts,
                submission.ownerAccountId.value
              )}
                AND idempotency_key_hash = ANY($imageKeys)
              ORDER BY ${ids.wireId("source_images")} FOR UPDATE""".query[(
                String,
                Option[Instant]
            )].to[List]
            admitted <-
              if images.exists { case (status, deletionClaim) =>
                  status == "DELETE_PENDING" || status == "DELETED" || deletionClaim.nonEmpty
                }
              then
                Left(
                  AppError.Conflict("An image from this request is no longer available.")
                ).pure[ConnectionIO]
              else
                // A refused PUT must leave the initial draft editable. Existing result slots keep
                // their status until a new job attaches, including submissions with no accepted job.
                insert(submission).flatTap { _ =>
                  sql"""UPDATE match_drafts SET status = 'ocr_running',
              updated_at = clock_timestamp()
              WHERE id = ${ids.lookup(
                      Entity.MatchDrafts,
                      submission.matchDraftId.value
                    )} AND status <> 'ocr_running'
                AND total_assets_image_id IS NULL AND revenue_image_id IS NULL
                AND incident_log_image_id IS NULL AND total_assets_draft_id IS NULL
                AND revenue_draft_id IS NULL AND incident_log_draft_id IS NULL""".update.run
                }
                  .map(Right(_))
          yield admitted
    yield result

  override def failAdmission(
      owner: AccountId,
      keyHash: String,
      sha256: String,
      byteLength: Int
  ): F[Unit] =
    val program =
      for
        affected <- sql"""SELECT ${ids.wireId("s")}, ${ids.retainedColumn(
            "s",
            "match_draft_id"
          )} FROM ocr_submissions s
        JOIN ocr_submission_members m ON m.submission_id = s.id
        WHERE s.owner_account_id = ${ids.lookup(
            Entity.Accounts,
            owner.value
          )} AND s.status = 'open' AND m.status = 'pending'
          AND m.upload_idempotency_key_hash = $keyHash
          AND m.image_sha256_hex = $sha256 AND m.image_byte_length = $byteLength
        ORDER BY ${ids.retainedColumn(
            "s",
            "match_draft_id"
          )}, ${ids.wireId("s")}""".query[(String, MatchDraftId)].to[List]
        _ <- affected.map(_._2).distinct.sortBy(_.value).traverse_(lockDraft)
        _ <- affected.map(_._1).distinct.sorted.traverse_(lock)
        _ <- affected.traverse_ { case (id, _) =>
          sql"""
          UPDATE ocr_submission_members m SET status = 'failed', failure_code = 'admission_failed'
          FROM ocr_submissions s
          WHERE m.submission_id = s.id AND s.id = ${ids.lookup(
              Entity.OcrSubmissions,
              id
            )} AND s.owner_account_id = ${ids.lookup(Entity.Accounts, owner.value)}
            AND s.status = 'open' AND m.status = 'pending'
            AND s.admission_deadline > clock_timestamp()
            AND m.upload_idempotency_key_hash = $keyHash
            AND m.image_sha256_hex = $sha256 AND m.image_byte_length = $byteLength
        """.update.run.void
        }
      yield ()
    program.transact(transactor)

private[api] object PostgresOcrSubmissions:
  private final case class Header(
      id: String,
      owner: AccountId,
      draftId: MatchDraftId,
      hints: String,
      status: String,
      deadline: Instant,
      createdAt: Instant,
      finishedAt: Option[Instant],
  )

  def read(id: String)(using ids: PostgresIdentities): ConnectionIO[Option[OcrSubmission]] =
    sql"""SELECT ${ids.wireId("ocr_submissions")}, ${ids.wireReference(
        Entity.Accounts,
        fr"ocr_submissions.owner_account_id"
      )},
      ${ids.retainedColumn("ocr_submissions", "match_draft_id")}, ocr_hints_json::text, status,
      admission_deadline, created_at, finished_at FROM ocr_submissions WHERE id = ${ids.lookup(
        Entity.OcrSubmissions,
        id
      )}"""
      .query[Header].option.flatMap(_.traverse { header =>
        for
          hints <- decode[OcrJobHints](header.hints).left.map(_ =>
            PostgresDataIntegrityException.inconsistentRow(
              "ocr_submissions",
              id,
              "invalid reading conditions"
            )
          ).liftTo[ConnectionIO]
          members <- sql"""SELECT screen_type, upload_idempotency_key_hash, image_sha256_hex,
            image_byte_length, status, ${ids.wireReference(
              Entity.OcrJobs,
              fr"ocr_submission_members.job_id"
            )}, failure_code FROM ocr_submission_members
            WHERE submission_id = ${ids.lookup(
              Entity.OcrSubmissions,
              id
            )} ORDER BY screen_type""".query[OcrSubmissionMember].to[List]
        yield OcrSubmission(
          header.id,
          header.owner,
          header.draftId,
          hints,
          header.status,
          header.deadline,
          header.createdAt,
          header.finishedAt,
          members
        )
      })

  def lockDraft(id: MatchDraftId)(using ids: PostgresIdentities): ConnectionIO[Unit] =
    sql"SELECT ${ids.wireId("match_drafts")} FROM match_drafts WHERE id = ${ids.lookup(Entity.MatchDrafts, id.value)} FOR UPDATE".query[
      String
    ].option.void

  def lock(id: String)(using ids: PostgresIdentities): ConnectionIO[Unit] =
    sql"SELECT ${ids.wireId("ocr_submissions")} FROM ocr_submissions WHERE id = ${ids.lookup(Entity.OcrSubmissions, id)} FOR UPDATE".query[
      String
    ].option.void

  def insert(submission: OcrSubmission)(using
      ids: PostgresIdentities): ConnectionIO[OcrSubmission] =
    val hints = OcrHintsCodec.encode(submission.ocrHints)
    for
      newId <- ids.newId(submission.id)
      owner <- ids.requireReference(Entity.Accounts, submission.ownerAccountId.value)
      draft <- ids.requireReference(Entity.MatchDrafts, submission.matchDraftId.value)
      legacyDraft <-
        sql"SELECT ${ids.wireReference(Entity.MatchDrafts, draft)}".query[MatchDraftId].unique
      timestamps <- sql"""INSERT INTO ocr_submissions
        (${ids.idColumns}, owner_account_id, match_draft_id ${ids.legacyColumn(
          "match_draft_id"
        )}, ocr_hints_json, status, admission_deadline, created_at)
        VALUES ($newId, $owner, $draft ${ids.legacyValue(legacyDraft.value)},
          $hints::jsonb, 'open', ${submission.admissionDeadline}, ${submission.createdAt})
        RETURNING admission_deadline, created_at""".query[(Instant, Instant)].unique
      _ <- submission.members.traverse_ { member =>
        sql"""INSERT INTO ocr_submission_members
          (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex, image_byte_length, status)
          VALUES (${ids.lookup(
            Entity.OcrSubmissions,
            submission.id
          )}, ${member.screenType}, ${member.uploadIdempotencyKeyHash},
            ${member.imageSha256}, ${member.imageByteLength}, 'pending')""".update.run.void
      }
    yield submission.copy(
      matchDraftId = legacyDraft,
      admissionDeadline = timestamps._1,
      createdAt = timestamps._2
    )

  /** The caller already owns every source draft lock; this must precede the notification gate. */
  def abortForDrafts(draftIds: List[MatchDraftId], now: Instant)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    if draftIds.isEmpty then ().pure[ConnectionIO]
    else
      val condition =
        ids.retainedIn("ocr_submissions", "match_draft_id", draftIds.map(_.value).distinct.sorted)
      sql"""SELECT ${ids.wireId("ocr_submissions")} FROM ocr_submissions
        WHERE $condition AND status = 'open' ORDER BY ${ids.wireId("ocr_submissions")} FOR UPDATE"""
        .query[String].to[List].flatMap { submissions =>
          if submissions.isEmpty then ().pure[ConnectionIO]
          else
            sql"""UPDATE ocr_submissions SET status = 'aborted', finished_at = GREATEST($now, clock_timestamp(), created_at)
            WHERE id = ANY(${ids.lookupArray(
                Entity.OcrSubmissions,
                submissions
              )}) AND status = 'open'""".update.run.void
        }
