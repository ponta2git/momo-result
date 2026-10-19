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
  private val saved = OcrSubmission(
    command.id,
    owner,
    command.matchDraftId,
    command.hints,
    "settled",
    createdAt.plusSeconds(OcrSubmissions.AdmissionSeconds),
    createdAt,
    Some(createdAt.plusSeconds(30)),
    command.members.map(_.copy(status = "failed"))
  )

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

  test(
    "replaying an expired settled submission preserves its deadline and outcomes without admission"
  ) {
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

  test("new submission input cannot inject persisted member outcomes") {
    val invalid = command.copy(members = command.members.map(_.copy(status = "registered")))
    service.put(invalid, owner, mustNotAdmit).map(result =>
      assertEquals(result.left.toOption.map(_.code), Some("VALIDATION_FAILED"))
    )
  }

  test("request identity ignores member order and outcomes but preserves hint order") {
    val member = OcrSubmissionMember(ScreenType.Revenue, "c" * 64, "d" * 64, 2)
    val original = saved.copy(
      members = command.members :+ member,
      ocrHints = OcrJobHints.empty.copy(computerPlayerAliases = List("first", "second"))
    )
    val reordered = original.copy(
      members =
        original.members.reverse.map(_.copy(status = "failed", failureCode = Some("failed"))),
      status = "aborted",
      admissionDeadline = createdAt,
    )
    assert(original.sameRequest(reordered))
    assert(!original.sameRequest(reordered.copy(
      ocrHints = original.ocrHints.copy(computerPlayerAliases = List("second", "first"))
    )))
  }

  test("fresh admission excludes the exact deadline and closed members") {
    val open = saved.copy(status = "open", members = command.members)
    assert(open.canAdmit(ScreenType.TotalAssets, open.admissionDeadline.minusNanos(1)))
    assert(!open.canAdmit(ScreenType.TotalAssets, open.admissionDeadline))
    assert(!open.copy(members = saved.members).canAdmit(ScreenType.TotalAssets, createdAt))
    assert(!saved.canAdmit(ScreenType.TotalAssets, createdAt))
  }
