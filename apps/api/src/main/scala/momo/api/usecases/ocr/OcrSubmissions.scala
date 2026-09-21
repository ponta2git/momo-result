package momo.api.usecases.ocr

import java.time.Instant
import java.util.UUID

import cats.Monad
import cats.syntax.all.*

import momo.api.codec.OcrHintsCodec
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.OcrSubmissionsRepository

final case class PutOcrSubmissionCommand(
    id: String,
    matchDraftId: MatchDraftId,
    hints: OcrJobHints,
    members: List[OcrSubmissionMember],
)

final class OcrSubmissions[F[_]: Monad](repository: OcrSubmissionsRepository[F], now: F[Instant]):
  def put(command: PutOcrSubmissionCommand, owner: AccountId): F[Either[AppError, OcrSubmission]] =
    OcrSubmissions.validate(command) match
      case Left(error) => error.asLeft[OcrSubmission].pure[F]
      case Right(_) => now.flatMap(timestamp =>
          repository.put(OcrSubmission(
            command.id,
            owner,
            command.matchDraftId,
            command.hints,
            "open",
            timestamp.plusSeconds(OcrSubmissions.AdmissionSeconds),
            timestamp,
            None,
            command.members,
          ))
        )

  def failAdmission(owner: AccountId, keyHash: String, sha256: String, byteLength: Int): F[Unit] =
    repository.failAdmission(owner, keyHash, sha256, byteLength)

  def get(id: String, owner: AccountId): F[Either[AppError, OcrSubmission]] =
    repository.find(id, owner).map(_.toRight(AppError.NotFound("OCR submission", id)))

object OcrSubmissions:
  val AdmissionSeconds = 600L
  val OpenLimit = 4

  def validId(value: String): Boolean = scala.util.Try(UUID.fromString(value)).toOption
    .exists(_.toString == value)

  private def validate(command: PutOcrSubmissionCommand): Either[AppError, Unit] =
    val members = command.members
    if !validId(command.id) then Left(AppError.ValidationFailed("submissionId must be a UUID."))
    else if members.isEmpty || members.size > 3 ||
      members.map(_.screenType).distinct.size != members.size ||
      members.map(_.uploadIdempotencyKeyHash).distinct.size != members.size
    then
      Left(AppError.ValidationFailed("Choose one to three distinct OCR screen types."))
    else if members.exists(m =>
        m.screenType == ScreenType.Auto ||
          !m.uploadIdempotencyKeyHash.matches("[0-9a-f]{64}") ||
          !m.imageSha256.matches("[0-9a-f]{64}") || m.imageByteLength <= 0 ||
          m.imageByteLength > 3 * 1024 * 1024
      )
    then Left(AppError.ValidationFailed("Invalid OCR submission image fingerprint."))
    else OcrHintsCodec.validate(command.hints).left.map(AppError.ValidationFailed.apply)
