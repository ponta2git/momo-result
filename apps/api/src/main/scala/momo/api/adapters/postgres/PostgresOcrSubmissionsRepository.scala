package momo.api.adapters.postgres

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.Async
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.parser.decode

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.codec.OcrHintsCodec
import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.OcrSubmissionsRepository
import momo.api.usecases.ocr.OcrSubmissions

final class PostgresOcrSubmissionsRepository[F[_]: Async](transactor: Transactor[F])
    extends OcrSubmissionsRepository[F]:
  import PostgresOcrSubmissions.*

  override def find(id: String, owner: AccountId): F[Option[OcrSubmission]] =
    sql"""SELECT id FROM ocr_submissions WHERE id = $id AND owner_account_id = $owner
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
        _ <- sql"SELECT id FROM ocr_submissions WHERE id = ${submission.id} FOR SHARE"
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
    program.transact(transactor).flatTap(_ => wake(transactor))

  private def admit(submission: OcrSubmission): ConnectionIO[Either[AppError, OcrSubmission]] =
    for
      draft <-
        sql"""SELECT status FROM match_drafts WHERE id = ${submission.matchDraftId} FOR UPDATE"""
          .query[String].option
      count <- sql"""SELECT COUNT(*) FROM ocr_submissions
      WHERE owner_account_id = ${submission.ownerAccountId} AND status = 'open'""".query[Long].unique
      result <-
        if draft.isEmpty then
          Left(AppError.NotFound("match draft", submission.matchDraftId.value)).pure[ConnectionIO]
        else if !draft.exists(s => s != "confirmed" && s != "cancelled") then
          Left(AppError.Conflict("The match draft cannot accept OCR.")).pure[ConnectionIO]
        else if count >= OcrSubmissions.OpenLimit then
          Left(AppError.TooManyRequests(
            "Too many unfinished OCR submissions. Retry after they finish."
          )).pure[ConnectionIO]
        else
          for
            usable <- submission.members.traverse { member =>
              sql"""SELECT status FROM source_images
            WHERE owner_account_id = ${submission.ownerAccountId}
              AND idempotency_key_hash = ${member.uploadIdempotencyKeyHash} FOR UPDATE"""
                .query[String].option.map(_.forall(s => s != "DELETE_PENDING" && s != "DELETED"))
            }
            admitted <-
              if usable.contains(false) then
                Left(
                  AppError.Conflict("An image from this request is no longer available.")
                ).pure[ConnectionIO]
              else
                // A refused PUT must leave the initial draft editable. Existing result slots keep
                // their status until a new job attaches, including submissions with no accepted job.
                (insert(submission) *> sql"""UPDATE match_drafts SET status = 'ocr_running',
              updated_at = clock_timestamp()
              WHERE id = ${submission.matchDraftId} AND status <> 'ocr_running'
                AND total_assets_image_id IS NULL AND revenue_image_id IS NULL
                AND incident_log_image_id IS NULL AND total_assets_draft_id IS NULL
                AND revenue_draft_id IS NULL AND incident_log_draft_id IS NULL""".update.run)
                  .as(Right(submission))
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
        ids <- sql"""SELECT s.id, s.match_draft_id FROM ocr_submissions s
        JOIN ocr_submission_members m ON m.submission_id = s.id
        WHERE s.owner_account_id = $owner AND s.status = 'open' AND m.status = 'pending'
          AND m.upload_idempotency_key_hash = $keyHash
          AND m.image_sha256_hex = $sha256 AND m.image_byte_length = $byteLength
        ORDER BY s.match_draft_id, s.id""".query[(String, MatchDraftId)].to[List]
        _ <- ids.map(_._2).distinct.sortBy(_.value).traverse_(lockDraft)
        _ <- ids.map(_._1).distinct.sorted.traverse_(lock)
        _ <- ids.traverse_ { case (id, _) =>
          sql"""
          UPDATE ocr_submission_members m SET status = 'failed', failure_code = 'admission_failed'
          FROM ocr_submissions s
          WHERE m.submission_id = s.id AND s.id = $id AND s.owner_account_id = $owner
            AND s.status = 'open' AND m.status = 'pending'
            AND s.admission_deadline > clock_timestamp()
            AND m.upload_idempotency_key_hash = $keyHash
            AND m.image_sha256_hex = $sha256 AND m.image_byte_length = $byteLength
        """.update.run.void
        }
      yield ()
    program.transact(transactor).flatTap(_ => wake(transactor))

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

  def read(id: String): ConnectionIO[Option[OcrSubmission]] =
    sql"""SELECT id, owner_account_id, match_draft_id, ocr_hints_json::text, status,
      admission_deadline, created_at, finished_at FROM ocr_submissions WHERE id = $id"""
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
            image_byte_length, status, job_id, failure_code FROM ocr_submission_members
            WHERE submission_id = $id ORDER BY screen_type""".query[OcrSubmissionMember].to[List]
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

  def lockDraft(id: MatchDraftId): ConnectionIO[Unit] =
    sql"SELECT id FROM match_drafts WHERE id = $id FOR UPDATE".query[String].option.void

  def lock(id: String): ConnectionIO[Unit] =
    sql"SELECT id FROM ocr_submissions WHERE id = $id FOR UPDATE".query[String].option.void

  def insert(submission: OcrSubmission): ConnectionIO[Unit] =
    val hints = OcrHintsCodec.encode(submission.ocrHints)
    sql"""INSERT INTO ocr_submissions
      (id, owner_account_id, match_draft_id, ocr_hints_json, status, admission_deadline, created_at)
      VALUES (${submission.id}, ${submission.ownerAccountId}, ${submission.matchDraftId},
        $hints::jsonb, 'open', ${submission.admissionDeadline}, ${submission.createdAt})""".update.run *>
      submission.members.traverse_ { member =>
        sql"""INSERT INTO ocr_submission_members
          (submission_id, screen_type, upload_idempotency_key_hash, image_sha256_hex, image_byte_length, status)
          VALUES (${submission.id}, ${member.screenType}, ${member.uploadIdempotencyKeyHash},
            ${member.imageSha256}, ${member.imageByteLength}, 'pending')""".update.run.void
      }

  /** The caller already owns every source draft lock; this must precede the notification gate. */
  def abortForDrafts(ids: List[MatchDraftId], now: Instant): ConnectionIO[Unit] =
    if ids.isEmpty then ().pure[ConnectionIO]
    else
      val raw = ids.map(_.value).distinct.sorted.toArray
      sql"""SELECT id FROM ocr_submissions
        WHERE match_draft_id = ANY($raw) AND status = 'open' ORDER BY id FOR UPDATE"""
        .query[String].to[List].flatMap { submissions =>
          if submissions.isEmpty then ().pure[ConnectionIO]
          else
            sql"""UPDATE ocr_submissions SET status = 'aborted', finished_at = GREATEST($now, clock_timestamp(), created_at)
            WHERE id = ANY(${submissions.toArray}) AND status = 'open'""".update.run.void
        }

  /** A lost hint is recovered by the Worker's bounded open-submission scan. */
  def wake[F[_]: Async](transactor: Transactor[F]): F[Unit] =
    val warn = Async[F].delay(org.slf4j.LoggerFactory.getLogger("momo.api.ocr.submissions")
      .warn("ocr_submission_wake_unavailable recovery=bounded_open_scan"))
    Async[F].timeoutTo(
      sql"SELECT pg_notify('ocr_submissions', '')".query[Unit].unique.transact(transactor),
      500.millis,
      warn,
    ).handleErrorWith(_ => warn)
