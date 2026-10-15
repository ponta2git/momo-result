package momo.api.usecases.ocr

import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.OcrSubmissionsRepository

final class OcrSubmissionsSpec extends MomoCatsEffectSuite:
  private val owner = AccountId.unsafeFromString("account-1")
  private val command = PutOcrSubmissionCommand(
    "00000000-0000-0000-0000-000000000001",
    MatchDraftId.unsafeFromString("draft-1"),
    OcrJobHints.empty,
    List(OcrSubmissionMember(ScreenType.TotalAssets, "a" * 64, "b" * 64, 1)),
  )
  private val createdAt = Instant.parse("2024-01-01T00:00:00Z")
  private val saved = OcrSubmission(command.id, owner, command.matchDraftId, command.hints,
    "settled", createdAt.plusSeconds(OcrSubmissions.AdmissionSeconds), createdAt,
    Some(createdAt.plusSeconds(30)), command.members.map(_.copy(status = "failed")))

  private val repository = new OcrSubmissionsRepository[IO]:
    def find(id: String, account: AccountId): IO[Option[OcrSubmission]] =
      IO.pure(Option.when(id == saved.id && account == owner)(saved))
    def put(submission: OcrSubmission): IO[Either[AppError, OcrSubmission]] =
      IO.raiseError(new IllegalStateException("a replay must not write"))
    def failAdmission(account: AccountId, key: String, sha: String, length: Int): IO[Unit] =
      IO.unit

  private val service = OcrSubmissions(repository, IO.pure(saved.admissionDeadline.plusSeconds(1)))
  private val mustNotAdmit: IO[Either[AppError, Unit]] =
    IO.raiseError(new IllegalStateException("existing requests must not consume admission quota"))

  test("replaying an expired settled submission preserves its deadline and outcomes without admission") {
    service.put(command, owner, mustNotAdmit).map(result => assertEquals(result, Right(saved)))
  }

  test("an existing ID with another fingerprint conflicts without admission") {
    val changed = command.copy(members = command.members.map(_.copy(imageSha256 = "c" * 64)))
    service.put(changed, owner, mustNotAdmit).map(result =>
      assert(result.left.exists {
        case _: AppError.Conflict => true
        case _ => false
      })
    )
  }

  test("another account cannot reuse the owner's replay exemption") {
    val denied = AppError.TooManyRequests("new submission quota")
    service.put(command, AccountId.unsafeFromString("account-2"), IO.pure(Left(denied)))
      .map(result => assertEquals(result, Left(denied)))
  }
