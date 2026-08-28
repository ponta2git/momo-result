package momo.api.usecases.ocr

import java.time.Instant

import cats.effect.{IO, Resource}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.{
  InMemoryMatchDraftsRepository,
  InMemoryMemberAliasesRepository,
  InMemoryOcrDraftsRepository,
  InMemoryOcrJobCreationStore,
  InMemoryOcrJobQueuePublisher,
  InMemoryOcrJobsRepository
}
import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.domain.ids.{
  AccountId,
  ImageId,
  MatchDraftId,
  MemberAliasId,
  MemberId,
  OcrDraftId,
  OcrJobId
}
import momo.api.domain.{
  MatchDraft,
  MatchDraftStatus,
  MemberAlias,
  OcrJob,
  OcrJobHints,
  PlayerAliasHint,
  ScreenType,
  StoredImage,
  StoredImageLocation
}
import momo.api.errors.AppError
import momo.api.ports.storage.ImageStorage
import momo.api.testing.AppErrorAssertions.fromAppEither
import momo.api.testing.TestImages

final class CreateOcrJobSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val now = Instant.parse("2026-04-29T11:40:16Z")

  private val pngBytes: Array[Byte] = TestImages.png1x1

  test("creates empty draft, queued job, and enqueue request") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job",
      idSeed = List("job-1", "draft-1"),
      requestId = Some("test-req-id"),
      activeJobLimit = 12,
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        created <- usecase.run(
          CreateOcrJobCommand(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, None),
          fixture.requestId,
        ).flatMap(fromAppEither)
        foundJob <- fixture.jobs.find(created.job.id)
        foundDraft <- fixture.drafts.find(created.draft.id)
        published <- fixture.queue.published
      yield
        assertEquals(foundJob.map(_.status.wire), Some("queued"))
        assertEquals(foundDraft.map(_.id), Some(created.draft.id))
        assertEquals(published.map(_.jobId.value), Vector("job-1"))
        assertEquals(published.head.requestedScreenType, ScreenType.TotalAssets)
        assertEquals(published.head.attempt, 1)
        assertEquals(published.head.requestId, Some("test-req-id"))
    }
  }

  test("merges member aliases from DB into OCR queue hints") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-aliases",
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      activeJobLimit = 12,
    ).use { fixture =>
      for
        image <- fixture.savePng
        _ <- fixture.memberAliases.create(MemberAlias(
          id = MemberAliasId.unsafeFromString("alias-1"),
          memberId = MemberId.unsafeFromString("member_ponta"),
          alias = "ポン太社長",
          createdAt = now,
        ))
        usecase <- fixture.usecase
        _ <- usecase.run(
          CreateOcrJobCommand(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints(
              gameTitle = None,
              layoutFamily = None,
              knownPlayerAliases =
                List(PlayerAliasHint(MemberId.unsafeFromString("member_ponta"), List("ぽんた"))),
              computerPlayerAliases = Nil,
            ),
            None,
          ),
          fixture.requestId,
        ).flatMap(fromAppEither)
        published <- fixture.queue.published
      yield assertEquals(
        published.head.hints.knownPlayerAliases,
        List(PlayerAliasHint(MemberId.unsafeFromString("member_ponta"), List("ぽんた", "ポン太社長"))),
      )
    }
  }

  test("rejects OCR hints that exceed Redis payload contract limits") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-hints-limit",
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      activeJobLimit = 12,
    ).use { fixture =>
      for
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(
            ImageId.unsafeFromString("missing-image"),
            ScreenType.TotalAssets,
            OcrJobHints(
              gameTitle = None,
              layoutFamily = None,
              knownPlayerAliases =
                List(PlayerAliasHint(MemberId.unsafeFromString("member-1"), List.fill(9)("alias"))),
              computerPlayerAliases = Nil,
            ),
            None,
          ),
          fixture.requestId,
        )
      yield result match
        case Left(AppError.ValidationFailed(detail)) =>
          assert(detail.contains("ocrHints.knownPlayerAliases[0].aliases"))
        case other => fail(s"expected Left(AppError.ValidationFailed), got: $other")
    }
  }

  test("rejects before creating OCR records when admission guard is closed") {
    val rejectingAdmission = new OcrAdmissionGuard[IO]:
      override def ensureAvailable: IO[Either[AppError, Unit]] = IO.pure(Left(
        AppError.ServiceUnavailable("OCR queue is temporarily unavailable. Try again later.")
      ))
      override def healthStatus: IO[String] = IO.pure("degraded:test")

    inMemoryQueueFixture(
      prefix = "momo-api-create-job-admission-closed",
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      activeJobLimit = 12,
      admissionGuard = rejectingAdmission,
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, None),
          fixture.requestId,
        )
        foundJob <- fixture.jobs.find(OcrJobId.unsafeFromString("job-1"))
        foundDraft <- fixture.drafts.find(OcrDraftId.unsafeFromString("draft-1"))
        published <- fixture.queue.published
      yield
        result match
          case Left(AppError.ServiceUnavailable(detail)) =>
            assert(detail.contains("OCR queue is temporarily unavailable"))
          case other => fail(s"expected Left(AppError.ServiceUnavailable), got: $other")
        assertEquals(foundJob, None)
        assertEquals(foundDraft, None)
        assertEquals(published, Vector.empty)
    }
  }

  test("rejects re-running a draft OCR slot while its previous job is active") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-active-slot",
      idSeed = List("job-new-slot", "draft-new-slot"),
      requestId = None,
      activeJobLimit = 12,
    ).use { fixture =>
      val matchDraftId = MatchDraftId.unsafeFromString("match-draft-active-slot")
      val oldDraftId = OcrDraftId.unsafeFromString("draft-active-slot")
      val oldJobId = OcrJobId.unsafeFromString("job-active-slot")
      val oldImageId = ImageId.unsafeFromString("image-active-slot")
      for
        image <- fixture.savePng
        _ <- fixture.matchDrafts.create(draftWithTotalAssetsSlot(
          matchDraftId,
          oldDraftId,
          oldImageId,
          MatchDraftStatus.OcrRunning,
        ))
        _ <- fixture.jobs.create(queuedJob(oldJobId, oldDraftId, oldImageId, image.location))
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints.empty,
            Some(matchDraftId),
          ),
          fixture.requestId,
        )
        found <- fixture.matchDrafts.find(matchDraftId)
        published <- fixture.queue.published
      yield
        result match
          case Left(AppError.Conflict(detail)) =>
            assert(detail.contains("match draft could not be attached"))
          case other => fail(s"expected Left(AppError.Conflict), got: $other")
        assertEquals(found.flatMap(_.totalAssetsDraftId), Some(oldDraftId))
        assertEquals(published, Vector.empty)
    }
  }

  test("allows re-running a draft OCR slot after its previous job is terminal") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-terminal-slot",
      idSeed = List("job-new-slot", "draft-new-slot"),
      requestId = None,
      activeJobLimit = 12,
    ).use { fixture =>
      val matchDraftId = MatchDraftId.unsafeFromString("match-draft-terminal-slot")
      val oldDraftId = OcrDraftId.unsafeFromString("draft-terminal-slot")
      val oldJobId = OcrJobId.unsafeFromString("job-terminal-slot")
      val oldImageId = ImageId.unsafeFromString("image-terminal-slot")
      val newDraftId = OcrDraftId.unsafeFromString("draft-new-slot")
      for
        image <- fixture.savePng
        _ <- fixture.matchDrafts.create(
          draftWithTotalAssetsSlot(matchDraftId, oldDraftId, oldImageId, MatchDraftStatus.OcrFailed)
        )
        _ <- fixture.jobs.create(queuedJob(oldJobId, oldDraftId, oldImageId, image.location))
        _ <- fixture.jobs.cancelQueued(oldJobId, now)
        usecase <- fixture.usecase
        created <- usecase.run(
          CreateOcrJobCommand(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints.empty,
            Some(matchDraftId),
          ),
          fixture.requestId,
        ).flatMap(fromAppEither)
        found <- fixture.matchDrafts.find(matchDraftId)
        published <- fixture.queue.published
      yield
        assertEquals(created.draft.id, newDraftId)
        assertEquals(found.flatMap(_.totalAssetsDraftId), Some(newDraftId))
        assertEquals(found.map(_.status), Some(MatchDraftStatus.OcrRunning))
        assertEquals(published.map(_.jobId.value), Vector("job-new-slot"))
    }
  }

  private def inMemoryQueueFixture(
      prefix: String,
      idSeed: List[String],
      requestId: Option[String],
      activeJobLimit: Int,
  ): Resource[IO, Fixture] =
    inMemoryQueueFixture(prefix, idSeed, requestId, activeJobLimit, OcrAdmissionGuard.allowAll[IO])

  private def inMemoryQueueFixture(
      prefix: String,
      idSeed: List[String],
      requestId: Option[String],
      activeJobLimit: Int,
      admissionGuard: OcrAdmissionGuard[IO],
  ): Resource[IO, Fixture] = tempDirectory(prefix).evalMap { dir =>
    for
      jobs <- InMemoryOcrJobsRepository.create[IO]
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      memberAliases <- InMemoryMemberAliasesRepository.create[IO]
      queue <- InMemoryOcrJobQueuePublisher.create[IO]
      imageStore = LocalFsImageStore[IO](dir)
    yield Fixture(
      imageStore,
      jobs,
      drafts,
      matchDrafts,
      memberAliases,
      queue,
      idSeed,
      requestId,
      activeJobLimit,
      admissionGuard,
    )
  }

  private def editableDraft(id: MatchDraftId): MatchDraft = MatchDraft.fromInputs(
    id = id,
    createdByAccountId = AccountId.unsafeFromString("account_ponta"),
    createdByMemberId = Some(MemberId.unsafeFromString("member_ponta")),
    status = MatchDraftStatus.DraftReady,
    heldEventId = None,
    matchNoInEvent = None,
    gameTitleId = None,
    layoutFamily = None,
    seasonMasterId = None,
    ownerMemberId = None,
    mapMasterId = None,
    playedAt = None,
    totalAssetsImageId = None,
    revenueImageId = None,
    incidentLogImageId = None,
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
    sourceImagesRetainedUntil = None,
    sourceImagesDeletedAt = None,
    confirmedMatchId = None,
    createdAt = now,
    updatedAt = now,
  ).getOrElse(fail("test fixture draft should be valid"))

  private def draftWithTotalAssetsSlot(
      id: MatchDraftId,
      ocrDraftId: OcrDraftId,
      imageId: ImageId,
      status: MatchDraftStatus,
  ): MatchDraft = MatchDraft.editable(
    editableDraft(id).common
      .copy(totalAssetsImageId = Some(imageId), totalAssetsDraftId = Some(ocrDraftId)),
    status,
  ).getOrElse(fail("test fixture draft should be editable"))

  private def queuedJob(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imageLocation: StoredImageLocation,
  ): OcrJob = OcrJob.Queued(
    id = id,
    draftId = draftId,
    imageId = imageId,
    imageLocation = imageLocation,
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private final case class Fixture(
      imageStore: ImageStorage[IO],
      jobs: InMemoryOcrJobsRepository[IO],
      drafts: InMemoryOcrDraftsRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      memberAliases: InMemoryMemberAliasesRepository[IO],
      queue: InMemoryOcrJobQueuePublisher[IO],
      idSeed: List[String],
      requestId: Option[String],
      activeJobLimit: Int,
      admissionGuard: OcrAdmissionGuard[IO],
  ):
    def savePng: IO[StoredImage] = imageStore.save(
      AccountId.unsafeFromString("account-1"),
      Some("sample.png"),
      Some("image/png"),
      pngBytes,
    ).flatMap(fromAppEither)

    def usecase(using LoggerFactory[IO]): IO[CreateOcrJob[IO]] = IO.ref(idSeed).map { ids =>
      IO.pure {
        CreateOcrJob[IO](
          imageStore = imageStore,
          creationStore =
            InMemoryOcrJobCreationStore[IO](
              drafts,
              drafts.create,
              jobs,
              jobs.create,
              matchDrafts,
              jobs.existsActiveByDraft,
            ),
          matchDrafts = matchDrafts,
          queueSubmitter = OcrJobQueueSubmitter.nonDurable[IO](jobs, matchDrafts, queue),
          admissionGuard = admissionGuard,
          now = IO.pure(now),
          nextJobId = ids.modify {
            case head :: tail => tail -> OcrJobId.unsafeFromString(head)
            case Nil => Nil -> OcrJobId.unsafeFromString("unexpected-job")
          },
          nextDraftId = ids.modify {
            case head :: tail => tail -> OcrDraftId.unsafeFromString(head)
            case Nil => Nil -> OcrDraftId.unsafeFromString("unexpected-draft")
          },
          memberAliases = memberAliases,
          activeJobLimit = activeJobLimit,
        )
      }
    }.flatten
