package momo.api.usecases.ocr

import java.time.Instant
import java.util.UUID

import cats.Monad
import cats.syntax.all.*

import momo.api.codec.OcrHintsCodec
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.ports.storage.SourceImageObjectStorage
import momo.api.repositories.{EntityReferenceResolver, OcrSubmissionsRepository}
import momo.api.usecases.common.ReferenceNormalization

final case class PutOcrSubmissionCommand(
    id: String,
    matchDraftId: MatchDraftId,
    hints: OcrJobHints,
    members: List[OcrSubmissionMember],
)

final class OcrSubmissions[F[_]: Monad](
    repository: OcrSubmissionsRepository[F],
    now: F[Instant],
    references: Option[EntityReferenceResolver[F]] = None
):
  def put(
      command: PutOcrSubmissionCommand,
      owner: AccountId,
      admitNew: F[Either[AppError, Unit]],
  ): F[Either[AppError, OcrSubmission]] = ReferenceNormalization.submission(
    command,
    references.getOrElse(EntityReferenceResolver.preserve[F])
  )
    .flatMap(normalized => putResolved(normalized, owner, admitNew))

  private def putResolved(
      command: PutOcrSubmissionCommand,
      owner: AccountId,
      admitNew: F[Either[AppError, Unit]]
  ): F[Either[AppError, OcrSubmission]] =
    OcrSubmissions.validate(command) match
      case Left(error) => error.asLeft[OcrSubmission].pure[F]
      case Right(_) => now.flatMap { timestamp =>
          val submission = OcrSubmission(
            command.id,
            owner,
            command.matchDraftId,
            command.hints,
            "open",
            timestamp.plusSeconds(OcrSubmissions.AdmissionSeconds),
            timestamp,
            None,
            command.members,
          )
          repository.find(command.id, owner).flatMap {
            case Some(saved) =>
              // Replays retain the original deadline and current member outcomes.
              Either.cond(
                saved.sameRequest(submission),
                saved,
                AppError.Conflict("This submissionId belongs to another request.")
              )
                .pure[F]
            case None => OcrHintsCodec.validate(command.hints) match
                case Left(error) => AppError.ValidationFailed(error).asLeft[OcrSubmission].pure[F]
                case Right(_) => admitNew.flatMap {
                    case Left(error) => error.asLeft[OcrSubmission].pure[F]
                    // The atomic put still guards races and ownership after this lookup.
                    case Right(_) => repository.put(submission)
                  }
          }
        }

  def failAdmission(owner: AccountId, keyHash: String, sha256: String, byteLength: Int): F[Unit] =
    repository.failAdmission(owner, keyHash, sha256, byteLength)

  def get(id: String, owner: AccountId): F[Either[AppError, OcrSubmission]] =
    repository.find(id, owner).map(_.toRight(AppError.NotFound("OCR submission", id)))

object OcrSubmissions:
  val AdmissionSeconds = 600L

  def validId(value: String): Boolean = scala.util.Try(UUID.fromString(value)).toOption
    .exists(_.toString == value)

  private def validate(command: PutOcrSubmissionCommand): Either[AppError, Unit] =
    val validation =
      for
        _ <- Either.cond(validId(command.id), (), "submissionId must be a UUID.")
        _ <- OcrSubmission.validateNewMembers(command.members)
        _ <- Either.cond(
          !command.members.exists(m =>
            !m.uploadIdempotencyKeyHash.matches("[0-9a-f]{64}") ||
              !m.imageSha256.matches("[0-9a-f]{64}") || m.imageByteLength <= 0 ||
              m.imageByteLength > SourceImageObjectStorage.MaxUploadBytes
          ),
          (),
          "Invalid OCR submission image fingerprint."
        )
        _ <- OcrHintsCodec.validateShape(command.hints)
      yield ()
    validation.left.map(AppError.ValidationFailed.apply)
