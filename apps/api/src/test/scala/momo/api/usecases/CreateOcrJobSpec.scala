package momo.api.usecases

import java.time.Instant

import cats.effect.{IO, Resource}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.{
  InMemoryMatchDraftsRepository, InMemoryMemberAliasesRepository, InMemoryOcrDraftsRepository,
  InMemoryOcrJobCreationRepository, InMemoryOcrJobsRepository, InMemoryQueueProducer,
  LocalFsImageStore,
}
import momo.api.codec.OcrHintsCodec.given
import momo.api.domain.ids.{
  AccountId, ImageId, MatchDraftId, MemberAliasId, MemberId, OcrDraftId, OcrJobId,
}
import momo.api.domain.{
  MatchDraft, MatchDraftStatus, MemberAlias, OcrJob, OcrJobHints, PlayerAliasHint, ScreenType,
  StoredImage,
}
import momo.api.errors.AppError
import momo.api.repositories.{ImageStore, OcrJobsRepository, QueueProducer}
import momo.api.testing.AppErrorAssertions.fromAppEither
import momo.api.testing.{FailingMarkFailedOcrJobsRepository, FailingQueueProducer, TestImages}
import momo.api.usecases.testing.CapturingLoggerFactory

final class CreateOcrJobSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val now = Instant.parse("2026-04-29T11:40:16Z")

  private val pngBytes: Array[Byte] = TestImages.png1x1

  test("creates empty draft, queued job, and stream payload") {
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
        assertEquals(published.map(_.fields("jobId")), Vector("job-1"))
        assertEquals(published.head.fields("schemaVersion"), "1")
        assertEquals(published.head.fields("requestedScreenType"), "total_assets")
        assertEquals(published.head.fields.get("requestId"), Some("test-req-id"))
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
        hintsJson = published.head.fields("ocrHintsJson")
        parsed = io.circe.parser.decode[OcrJobHints](hintsJson)
      yield assertEquals(
        parsed.map(_.knownPlayerAliases),
        Right(
          List(PlayerAliasHint(MemberId.unsafeFromString("member_ponta"), List("ぽんた", "ポン太社長")))
        ),
      )
    }
  }

  test("returns DependencyFailed and does not raise when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    fixtureResource(
      prefix = "momo-api-create-job-fail",
      queue = FailingQueueProducer(queueError),
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      decorateJobs = delegate => FailingMarkFailedOcrJobsRepository(delegate, markFailedError),
      activeJobLimit = 12,
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, None),
          fixture.requestId,
        )
      yield result match
        case Left(_: AppError.DependencyFailed) => ()
        case other => fail(s"expected Left(AppError.DependencyFailed), got: $other")
    }
  }

  test("stores sanitized failure message when queue.publish fails") {
    val queueError = new RuntimeException("redis://secret-host/boom")

    fixtureResource(
      prefix = "momo-api-create-job-sanitized-failure",
      queue = FailingQueueProducer(queueError),
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      decorateJobs = identity[OcrJobsRepository[IO]],
      activeJobLimit = 12,
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        _ <- usecase.run(
          CreateOcrJobCommand(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, None),
          fixture.requestId,
        )
        found <- fixture.jobs.find(OcrJobId.unsafeFromString("job-1"))
      yield
        val failure = found.flatMap(OcrJob.failure).getOrElse(fail("expected failed job"))
        assertEquals(failure.message, "Failed to enqueue OCR job.")
        assert(!failure.message.contains("secret-host"))
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

  test("rejects when the active OCR job limit is reached") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-active-limit",
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      activeJobLimit = 0,
    ).use { fixture =>
      for
        image <- fixture.savePng
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, None),
          fixture.requestId,
        )
        published <- fixture.queue.published
        active <- fixture.jobs.countActive
      yield
        result match
          case Left(AppError.ServiceUnavailable(detail)) =>
            assert(detail.contains("OCR queue is currently full"))
          case other => fail(s"expected Left(AppError.ServiceUnavailable), got: $other")
        assertEquals(published, Vector.empty)
        assertEquals(active, 0L)
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

  test("rejects auto screen type when attaching OCR to an existing match draft") {
    inMemoryQueueFixture(
      prefix = "momo-api-create-job-auto-match-draft",
      idSeed = List("job-1", "draft-1"),
      requestId = None,
      activeJobLimit = 12,
    ).use { fixture =>
      val matchDraftId = MatchDraftId.unsafeFromString("match-draft-auto-rejected")
      for
        image <- fixture.savePng
        _ <- fixture.matchDrafts.create(editableDraft(matchDraftId))
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(
            image.imageId,
            ScreenType.Auto,
            OcrJobHints.empty,
            Some(matchDraftId),
          ),
          fixture.requestId,
        )
        published <- fixture.queue.published
      yield
        result match
          case Left(AppError.ValidationFailed(detail)) =>
            assert(detail.contains("requestedScreenType=auto"))
          case other => fail(s"expected Left(AppError.ValidationFailed), got: $other")
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
        _ <- fixture.jobs.create(queuedJob(oldJobId, oldDraftId, oldImageId, image.path))
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
        _ <- fixture.jobs.create(queuedJob(oldJobId, oldDraftId, oldImageId, image.path))
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
        assertEquals(published.map(_.fields("jobId")), Vector("job-new-slot"))
    }
  }

  test("logs publish and compensation failures when both queue.publish and markFailed fail") {
    val queueError = new RuntimeException("boom-queue")
    val markFailedError = new RuntimeException("boom-markFailed")

    fixtureResource(
      prefix = "momo-api-create-job-log",
      queue = FailingQueueProducer(queueError),
      idSeed = List("job-log-1", "draft-log-1"),
      requestId = None,
      decorateJobs = delegate => FailingMarkFailedOcrJobsRepository(delegate, markFailedError),
      activeJobLimit = 12,
    ).use { fixture =>
      for
        capture <- CapturingLoggerFactory.create[IO]
        (factory, ref) = capture
        given LoggerFactory[IO] = factory
        image <- fixture.savePng
        usecase <- fixture.usecase
        result <- usecase.run(
          CreateOcrJobCommand(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, None),
          fixture.requestId,
        )
        logged <- ref.get
      yield
        // Original dependency failure is still surfaced to the caller (enqueue failure not swallowed).
        result match
          case Left(_: AppError.DependencyFailed) => ()
          case other => fail(s"expected Left(AppError.DependencyFailed), got: $other")
        // Original publish failure and secondary compensation failure are both logged.
        assertEquals(logged.size, 2)
        val entry = logged(1)
        assertEquals(entry.throwable, None)
        assert(
          entry.message.contains("jobId=job-log-1"),
          s"message missing jobId: ${entry.message}",
        )
        assert(
          entry.message.contains("draftId=draft-log-1"),
          s"message missing draftId: ${entry.message}",
        )
        assert(
          entry.message.contains("compensation"),
          s"message missing 'compensation' marker: ${entry.message}",
        )
        assert(
          entry.message.contains(s"compensationErrorClasses=${markFailedError.getClass.getName}"),
          s"message missing compensation error class: ${entry.message}",
        )
    }
  }

  private def inMemoryQueueFixture(
      prefix: String,
      idSeed: List[String],
      requestId: Option[String],
      activeJobLimit: Int,
  ): Resource[IO, Fixture[InMemoryQueueProducer[IO]]] =
    inMemoryQueueFixture(prefix, idSeed, requestId, activeJobLimit, OcrAdmissionGuard.allowAll[IO])

  private def inMemoryQueueFixture(
      prefix: String,
      idSeed: List[String],
      requestId: Option[String],
      activeJobLimit: Int,
      admissionGuard: OcrAdmissionGuard[IO],
  ): Resource[IO, Fixture[InMemoryQueueProducer[IO]]] = Resource
    .eval(InMemoryQueueProducer.create[IO]).flatMap(queue =>
      fixtureResource(
        prefix = prefix,
        queue = queue,
        idSeed = idSeed,
        requestId = requestId,
        decorateJobs = identity[OcrJobsRepository[IO]],
        activeJobLimit = activeJobLimit,
        admissionGuard = admissionGuard,
      )
    )

  private def fixtureResource[Q <: QueueProducer[IO]](
      prefix: String,
      queue: Q,
      idSeed: List[String],
      requestId: Option[String],
      decorateJobs: OcrJobsRepository[IO] => OcrJobsRepository[IO],
      activeJobLimit: Int,
  ): Resource[IO, Fixture[Q]] = fixtureResource(
    prefix,
    queue,
    idSeed,
    requestId,
    decorateJobs,
    activeJobLimit,
    OcrAdmissionGuard.allowAll[IO],
  )

  private def fixtureResource[Q <: QueueProducer[IO]](
      prefix: String,
      queue: Q,
      idSeed: List[String],
      requestId: Option[String],
      decorateJobs: OcrJobsRepository[IO] => OcrJobsRepository[IO],
      activeJobLimit: Int,
      admissionGuard: OcrAdmissionGuard[IO],
  ): Resource[IO, Fixture[Q]] = tempDirectory(prefix).evalMap { dir =>
    for
      jobsBase <- InMemoryOcrJobsRepository.create[IO]
      drafts <- InMemoryOcrDraftsRepository.create[IO]
      matchDrafts <- InMemoryMatchDraftsRepository.create[IO]
      memberAliases <- InMemoryMemberAliasesRepository.create[IO]
      imageStore = LocalFsImageStore[IO](dir)
      jobs = decorateJobs(jobsBase)
    yield Fixture(
      imageStore,
      jobs,
      drafts,
      matchDrafts,
      memberAliases,
      jobsBase.existsActiveByDraft,
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
      imagePath: java.nio.file.Path,
  ): OcrJob = OcrJob.Queued(
    id = id,
    draftId = draftId,
    imageId = imageId,
    imagePath = imagePath,
    requestedScreenType = ScreenType.TotalAssets,
    attemptCount = 0,
    createdAt = now,
    updatedAt = now,
  )

  private final case class Fixture[Q <: QueueProducer[IO]](
      imageStore: ImageStore[IO],
      jobs: OcrJobsRepository[IO],
      drafts: InMemoryOcrDraftsRepository[IO],
      matchDrafts: InMemoryMatchDraftsRepository[IO],
      memberAliases: InMemoryMemberAliasesRepository[IO],
      activeJobForDraft: OcrDraftId => IO[Boolean],
      queue: Q,
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
          creation =
            InMemoryOcrJobCreationRepository[IO](drafts, jobs, matchDrafts, activeJobForDraft),
          matchDrafts = matchDrafts,
          queueSubmitter = OcrQueueSubmitter.direct[IO](jobs, matchDrafts, queue),
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
