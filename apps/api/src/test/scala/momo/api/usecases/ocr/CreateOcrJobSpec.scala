package momo.api.usecases.ocr

import java.time.Instant

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.{
  InMemoryMatchDraftsRepository,
  InMemoryMemberAliasesRepository,
  InMemoryOcrDraftsRepository,
  InMemoryOcrJobCreationStore,
  InMemoryOcrJobQueuePublisher,
  InMemoryOcrJobsRepository,
  InMemoryOcrSubmissionsRepository
}
import momo.api.adapters.storage.local.LocalFsImageStore
import momo.api.codec.OcrHintsCodec
import momo.api.domain.ids.{
  AccountId,
  ImageId,
  MatchDraftId,
  MatchId,
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

  private val defaultMatchDraftId = MatchDraftId.unsafeFromString("match-draft-create")

  private val pngBytes: Array[Byte] = TestImages.png1x1

  test("attaches OCR to a match draft without a held event and queues the image") {
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
          RequestedOcrJob(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints.empty,
            defaultMatchDraftId
          ),
          fixture.requestId,
        ).flatMap(fromAppEither)
        foundJob <- fixture.jobs.find(created.job.id)
        foundDraft <- fixture.drafts.find(created.draft.id)
        published <- fixture.queue.published
        matchDraft <- fixture.matchDrafts.find(defaultMatchDraftId)
      yield
        assertEquals(matchDraft.flatMap(_.heldEventId), None)
        assertEquals(matchDraft.flatMap(_.totalAssetsDraftId), Some(created.draft.id))
        assertEquals(foundJob.map(_.status.wire), Some("queued"))
        assertEquals(foundDraft.map(_.id), Some(created.draft.id))
        assertEquals(published.map(_.jobId.value), Vector("job-1"))
        assertEquals(published.head.requestedScreenType, ScreenType.TotalAssets)
        assertEquals(published.head.attempt, 1)
        assertEquals(published.head.requestId, Some("test-req-id"))
        assertEquals(
          published.head.hints.knownPlayerAliases.map(hint => hint.memberId.value -> hint.aliases),
          List(
            "member_ponta" -> List("ぽんた"),
            "member_akane_mami" -> List("あかねまみ", "NO11"),
            "member_otaka" -> List("おーたか", "オータカ"),
            "member_eu" -> List("いーゆー"),
          ),
        )
        assertEquals(published.head.hints.computerPlayerAliases, Nil)
    }
  }

  List("missing", "cancelled", "confirmed").foreach { state =>
    test(s"rejects a $state match draft before creating or publishing OCR") {
      inMemoryQueueFixture("momo-ocr-draft-guard", List("job-guard", "draft-guard"), None, 12)
        .use { fixture =>
          val id = MatchDraftId.unsafeFromString(s"match-draft-$state")
          val common = editableDraft(id).common
          val seed = state match
            case "cancelled" => fixture.matchDrafts.create(MatchDraft.Cancelled(common))
            case "confirmed" => fixture.matchDrafts.create(
                MatchDraft.Confirmed(common, MatchId.unsafeFromString("confirmed-match"))
              )
            case _ => IO.unit
          for
            _ <- seed
            image <- fixture.savePng
            usecase <- fixture.usecase
            result <- usecase.run(
              RequestedOcrJob(image.imageId, ScreenType.TotalAssets, OcrJobHints.empty, id),
              None,
            )
            job <- fixture.jobs.find(OcrJobId.unsafeFromString("job-guard"))
            draft <- fixture.drafts.find(OcrDraftId.unsafeFromString("draft-guard"))
            published <- fixture.queue.published
          yield
            result match
              case Left(_: AppError.NotFound) => assertEquals(state, "missing")
              case Left(_: AppError.Conflict) => assert(state != "missing")
              case other => fail(s"expected match draft rejection, got $other")
            assertEquals(job, None)
            assertEquals(draft, None)
            assertEquals(published, Vector.empty)
        }
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
          RequestedOcrJob(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints(
              gameTitle = None,
              layoutFamily = Some("reiwa"),
              knownPlayerAliases =
                List(PlayerAliasHint(MemberId.unsafeFromString("member_ponta"), List("ぽんた"))),
              computerPlayerAliases = List("えんま"),
            ),
            defaultMatchDraftId,
          ),
          fixture.requestId,
        ).flatMap(fromAppEither)
        published <- fixture.queue.published
      yield
        assertEquals(
          published.head.hints.knownPlayerAliases,
          List(PlayerAliasHint(MemberId.unsafeFromString("member_ponta"), List("ぽんた", "ポン太社長"))),
        )
        assertEquals(published.head.hints.computerPlayerAliases, List("えんま"))
    }
  }

  List("reiwa", "world", "momotetsu_2").foreach { layout =>
    test(s"preserves $layout hints without applying worker computer-player defaults") {
      inMemoryQueueFixture("momo-ocr-layout-hints", List("job-1", "draft-1"), None, 12)
        .use { fixture =>
          for
            image <- fixture.savePng
            usecase <- fixture.usecase
            _ <- usecase.run(
              RequestedOcrJob(
                image.imageId,
                ScreenType.TotalAssets,
                OcrJobHints.empty.copy(gameTitle = Some("桃太郎電鉄"), layoutFamily = Some(layout)),
                defaultMatchDraftId,
              ),
              None,
            ).flatMap(fromAppEither)
            published <- fixture.queue.published
          yield
            assertEquals(published.head.hints.gameTitle, Some("桃太郎電鉄"))
            assertEquals(published.head.hints.layoutFamily, Some(layout))
            assertEquals(published.head.hints.computerPlayerAliases, Nil)
        }
    }
  }

  test("normalizes persisted aliases after defaults and bounds the queued player hints") {
    inMemoryQueueFixture("momo-ocr-default-aliases", List("job-1", "draft-1"), None, 12)
      .use { fixture =>
        val aliases = List(" ぽんた社長 ", "社長", " ", " ポン太社長 ", "ポン太") ++
          (1 to 10).map(index => s"別名$index")
        for
          image <- fixture.savePng
          _ <- aliases.zipWithIndex.traverse_ { case (alias, index) =>
            fixture.memberAliases.create(MemberAlias(
              MemberAliasId.unsafeFromString(s"alias-$index"),
              MemberId.unsafeFromString("member_ponta"),
              alias,
              now,
            )).flatMap(fromAppEither)
          }
          _ <- fixture.memberAliases.create(MemberAlias(
            MemberAliasId.unsafeFromString("alias-other"),
            MemberId.unsafeFromString("member_other"),
            "別のメンバー",
            now,
          )).flatMap(fromAppEither)
          usecase <- fixture.usecase
          _ <- usecase.run(
            RequestedOcrJob(
              image.imageId,
              ScreenType.TotalAssets,
              OcrJobHints.empty,
              defaultMatchDraftId,
            ),
            None,
          ).flatMap(fromAppEither)
          published <- fixture.queue.published
        yield
          val hints = published.head.hints
          assertEquals(hints.knownPlayerAliases.length, 4)
          assertEquals(
            hints.knownPlayerAliases.head.aliases,
            List("ぽんた", "ポン太", "別名1", "別名2", "別名3", "別名4", "別名5", "別名6"),
          )
          assertEquals(OcrJobHints.validationErrors(hints), Nil)
      }
  }

  test("rejects invalid enriched aliases before storing OCR records or publishing") {
    inMemoryQueueFixture("momo-ocr-enriched-hints-limit", List("job-1", "draft-1"), None, 12)
      .use { fixture =>
        for
          _ <- fixture.memberAliases.create(MemberAlias(
            MemberAliasId.unsafeFromString("alias-too-long"),
            MemberId.unsafeFromString("member_ponta"),
            "桃" * (OcrJobHints.MaxAliasLength + 1),
            now,
          )).flatMap(fromAppEither)
          usecase <- fixture.usecase
          result <- usecase.run(
            RequestedOcrJob(
              ImageId.unsafeFromString("missing-image"),
              ScreenType.TotalAssets,
              OcrJobHints.empty,
              defaultMatchDraftId,
            ),
            None,
          )
          job <- fixture.jobs.find(OcrJobId.unsafeFromString("job-1"))
          draft <- fixture.drafts.find(OcrDraftId.unsafeFromString("draft-1"))
          published <- fixture.queue.published
        yield
          result match
            case Left(AppError.ValidationFailed(detail)) =>
              assert(detail.contains("ocrHints.knownPlayerAliases[0].aliases[1]"))
            case other => fail(s"expected enriched hints validation failure, got $other")
          assertEquals(job, None)
          assertEquals(draft, None)
          assertEquals(published, Vector.empty)
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
          RequestedOcrJob(
            ImageId.unsafeFromString("missing-image"),
            ScreenType.TotalAssets,
            OcrJobHints(
              gameTitle = None,
              layoutFamily = None,
              knownPlayerAliases =
                List(PlayerAliasHint(MemberId.unsafeFromString("member-1"), List.fill(9)("alias"))),
              computerPlayerAliases = Nil,
            ),
            defaultMatchDraftId,
          ),
          fixture.requestId,
        )
      yield result match
        case Left(AppError.ValidationFailed(detail)) =>
          assert(detail.contains("ocrHints.knownPlayerAliases[0].aliases"))
        case other => fail(s"expected Left(AppError.ValidationFailed), got: $other")
    }
  }

  test("rejects hints that exceed the encoded byte limit only after persisted aliases are merged") {
    inMemoryQueueFixture("momo-ocr-enriched-hints-bytes", List("job-1", "draft-1"), None, 12)
      .use { fixture =>
        val wide = "桃" * OcrJobHints.MaxAliasLength
        val requested = List.tabulate(4) { index =>
          PlayerAliasHint(MemberId.unsafeFromString(s"member-$index-" + "x" * 119), List(wide))
        }
        val hints = OcrJobHints(Some(wide), Some(wide), requested, List.fill(8)(wide))
        for
          _ <- requested.zipWithIndex.traverse_ { case (player, memberIndex) =>
            (1 to 7).toList.traverse_ { aliasIndex =>
              fixture.memberAliases.create(MemberAlias(
                MemberAliasId.unsafeFromString(s"alias-$memberIndex-$aliasIndex"),
                player.memberId,
                s"$memberIndex$aliasIndex" + "桃" * 62,
                now,
              )).flatMap(fromAppEither)
            }
          }
          usecase <- fixture.usecase
          result <- usecase.run(
            RequestedOcrJob(
              ImageId.unsafeFromString("missing-image"),
              ScreenType.TotalAssets,
              hints,
              defaultMatchDraftId,
            ),
            None,
          )
          job <- fixture.jobs.find(OcrJobId.unsafeFromString("job-1"))
          draft <- fixture.drafts.find(OcrDraftId.unsafeFromString("draft-1"))
          published <- fixture.queue.published
        yield
          assertEquals(OcrHintsCodec.validate(hints), Right(()))
          result match
            case Left(AppError.ValidationFailed(detail)) => assert(detail.contains("UTF-8 bytes"))
            case other => fail(s"expected encoded hints validation failure, got $other")
          assertEquals(job, None)
          assertEquals(draft, None)
          assertEquals(published, Vector.empty)
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
          RequestedOcrJob(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints.empty,
            defaultMatchDraftId
          ),
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
          RequestedOcrJob(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints.empty,
            matchDraftId,
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
          RequestedOcrJob(
            image.imageId,
            ScreenType.TotalAssets,
            OcrJobHints.empty,
            matchDraftId,
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
      _ <- matchDrafts.create(editableDraft(defaultMatchDraftId))
      submissions <- InMemoryOcrSubmissionsRepository.create[IO](matchDrafts)
      memberAliases <- InMemoryMemberAliasesRepository.create[IO]
      queue <- InMemoryOcrJobQueuePublisher.create[IO]
      imageStore = LocalFsImageStore[IO](dir)
    yield Fixture(
      imageStore,
      jobs,
      drafts,
      matchDrafts,
      submissions,
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
      submissions: InMemoryOcrSubmissionsRepository[IO],
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

    def usecase(using LoggerFactory[IO]): IO[PreparedOcrJob] = IO.ref(idSeed).map { ids =>
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
              submissions,
            ),
          matchDrafts = matchDrafts,
          submissions = submissions,
          jobs = jobs,
          drafts = drafts,
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
          aliasSnapshot = memberAliases.list(None).map(_.groupMap(_.memberId)(_.alias)),
          activeJobLimit = activeJobLimit,
        )
      }
    }.flatten.map(new PreparedOcrJob(_, submissions))

  private final case class RequestedOcrJob(
      imageId: ImageId,
      requestedScreenType: ScreenType,
      ocrHints: OcrJobHints,
      matchDraftId: MatchDraftId,
  )

  /** These image-level cases first admit the same immutable operation as the HTTP workflow. */
  private final class PreparedOcrJob(
      delegate: CreateOcrJob[IO],
      submissions: InMemoryOcrSubmissionsRepository[IO]
  ):
    def run(
        request: RequestedOcrJob,
        requestId: Option[String]
    ): IO[Either[AppError, CreatedOcrJob]] =
      val id = java.util.UUID.randomUUID().toString
      val owner = AccountId.unsafeFromString("account-1")
      val command = PutOcrSubmissionCommand(
        id,
        request.matchDraftId,
        request.ocrHints,
        List(momo.api.domain.OcrSubmissionMember(
          request.requestedScreenType,
          "a" * 64,
          momo.api.ports.storage.Sha256Hex.digest(pngBytes).value,
          pngBytes.length
        ))
      )
      new OcrSubmissions[IO](submissions, IO.pure(now)).put(command, owner).flatMap {
        case Left(error) => IO.pure(Left(error))
        case Right(_) => delegate.run(
            CreateOcrJobCommand(request.imageId, request.requestedScreenType, id),
            requestId,
            owner
          )
      }
