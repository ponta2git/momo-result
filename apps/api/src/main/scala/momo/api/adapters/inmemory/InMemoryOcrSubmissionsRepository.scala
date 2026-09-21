package momo.api.adapters.inmemory

import cats.effect.std.Semaphore
import cats.effect.{Async, Ref}
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.{MatchDraftsRepository, OcrSubmissionsRepository}
import momo.api.usecases.ocr.OcrSubmissions

final class InMemoryOcrSubmissionsRepository[F[_]: Async] private (
    state: Ref[F, Map[String, OcrSubmission]],
    mutex: Semaphore[F],
    drafts: MatchDraftsRepository[F],
) extends OcrSubmissionsRepository[F]:
  override def find(id: String, owner: AccountId): F[Option[OcrSubmission]] =
    state.get.map(_.get(id).filter(_.ownerAccountId == owner))

  override def put(submission: OcrSubmission): F[Either[AppError, OcrSubmission]] = mutex.permit.use { _ =>
    state.get.flatMap { saved => saved.get(submission.id) match
      case Some(existing) =>
        (if existing.sameRequest(submission) then Right(existing)
         else Left(AppError.Conflict("This submissionId belongs to another request."))).pure[F]
      case None => drafts.find(submission.matchDraftId).flatMap {
        case Some(draft) if draft.status != MatchDraftStatus.Confirmed && draft.status != MatchDraftStatus.Cancelled =>
          if saved.values.count(s => s.ownerAccountId == submission.ownerAccountId && s.status == "open") >= OcrSubmissions.OpenLimit then
            Left(AppError.TooManyRequests("Too many unfinished OCR submissions.")).pure[F]
          else state.update(_ + (submission.id -> submission)).as(Right(submission))
        case None => Left(AppError.NotFound("match draft", submission.matchDraftId.value)).pure[F]
        case _ => Left(AppError.Conflict("The match draft cannot accept OCR.")).pure[F]
      }
    }
  }

  override def failAdmission(owner: AccountId, keyHash: String, sha256: String, byteLength: Int): F[Unit] =
    mutex.permit.use(_ => state.update(_.map { case (id, submission) =>
      id -> (if submission.ownerAccountId == owner && submission.status == "open" then
        submission.copy(members = submission.members.map { member =>
          if member.status == "pending" && member.uploadIdempotencyKeyHash == keyHash &&
              member.imageSha256 == sha256 && member.imageByteLength == byteLength then
            member.copy(status = "failed", failureCode = Some("admission_failed"))
          else member
        }) else submission)
    }))

  private[inmemory] def serialized[A](operation: F[A]): F[A] = mutex.permit.use(_ => operation)

  private[inmemory] def register(id: String, screen: ScreenType, job: OcrJobId): F[Unit] =
    state.update(_.updatedWith(id)(_.map(s => s.copy(members = s.members.map { m =>
      if m.screenType == screen then m.copy(status = "registered", jobId = Some(job)) else m
    }))))

object InMemoryOcrSubmissionsRepository:
  def create[F[_]: Async](drafts: MatchDraftsRepository[F]): F[InMemoryOcrSubmissionsRepository[F]] =
    (Ref.of[F, Map[String, OcrSubmission]](Map.empty), Semaphore[F](1)).mapN(
      new InMemoryOcrSubmissionsRepository(_, _, drafts)
    )
