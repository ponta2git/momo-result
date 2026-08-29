package momo.api.bootstrap

import java.time.Instant

import cats.effect.{IO, Ref}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.ports.queue.OcrJobEnqueueRequest
import momo.api.repositories.*
import momo.api.repositories.OcrJobCreationStore.OcrJobCreationRejection
import momo.api.usecases.queue.{
  OutboxKind,
  OutboxWakeSink,
  OutboxWakeSubmitResult,
  PostCommitEffects
}
import momo.api.usecases.testing.MatchFixtures

final class OutboxWakingRepositoriesSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val now = Instant.parse("2026-08-15T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title-outbox-wake")
  private val accountId = AccountId.unsafeFromString("account-outbox-wake")

  test("OCR creation wakes only after an accepted durable result"):
    for
      result <- Ref.of[IO, OcrJobCreationStore.OcrJobCreationResult](Right(()))
      sink <- RecordingSink.create
      closed <- Ref.of[IO, Int](0)
      store = OutboxWakingRepositories.ocrJobCreation(
        ocrCreationStore(result),
        sink,
        closed.update(_ + 1),
      )
      accepted <- store.store(ocrPlan)
      _ <- result.set(Left(OcrJobCreationRejection.InvalidPlan))
      rejected <- store.store(ocrPlan)
      effects <- sink.effects
    yield
      assertEquals(accepted, Right(()))
      assertEquals(rejected, Left(OcrJobCreationRejection.InvalidPlan))
      assertEquals(effects, List(PostCommitEffects.wake(OutboxKind.Ocr)))

  test("match update and actual deletion wake analysis while false deletion does not"):
    for
      updateResult <- Ref.of[IO, Either[AppError, Unit]](Right(()))
      deleteResult <- Ref.of[IO, Boolean](true)
      sink <- RecordingSink.create
      closed <- Ref.of[IO, Int](0)
      repository = OutboxWakingRepositories.matches(
        matchesRepository(updateResult, deleteResult),
        sink,
        closed.update(_ + 1),
      )
      _ <- repository.update(matchRecord, now)
      _ <- updateResult.set(Left(AppError.Conflict("rejected")))
      rejected <- repository.update(matchRecord, now)
      deleted <- repository.delete(matchRecord.id)
      _ <- deleteResult.set(false)
      missing <- repository.delete(matchRecord.id)
      effects <- sink.effects
    yield
      assert(deleted)
      assert(!missing)
      assertEquals(rejected, Left(AppError.Conflict("rejected")))
      assertEquals(
        effects,
        List.fill(2)(PostCommitEffects.wake(OutboxKind.SeriesAnalysis)),
      )

  test("confirmation and recalculation wake only on accepted state transitions"):
    for
      confirmationResult <- Ref.of[IO, Either[AppError, MatchConfirmationResult]](
        Right(MatchConfirmationResult.Confirmed)
      )
      recalculationResult <- Ref.of[IO, Either[AppError, SeriesAnalysisRecalculationAccepted]](
        Right(acceptedRecalculation)
      )
      sink <- RecordingSink.create
      closed <- Ref.of[IO, Int](0)
      confirmations = OutboxWakingRepositories.matchConfirmation(
        confirmationRepository(confirmationResult),
        sink,
        closed.update(_ + 1),
      )
      analysis = OutboxWakingRepositories.seriesAnalysis(
        seriesAnalysisRepository(recalculationResult),
        sink,
        closed.update(_ + 1),
      )
      _ <- confirmations.confirm(matchRecord, None, now)
      _ <- confirmationResult.set(Right(MatchConfirmationResult.DraftSnapshotMismatch))
      _ <- confirmations.confirm(matchRecord, None, now)
      _ <- confirmationResult.set(Left(AppError.Conflict("rejected")))
      rejectedConfirmation <- confirmations.confirm(matchRecord, None, now)
      _ <- analysis.requestTitleRecalculation(titleId, accountId, "title-key")
      _ <- recalculationResult.set(Left(AppError.Conflict("rejected")))
      _ <- analysis.requestAllRecalculation(accountId, "all-key")
      effects <- sink.effects
    yield
      assertEquals(rejectedConfirmation, Left(AppError.Conflict("rejected")))
      assertEquals(
        effects,
        List.fill(2)(PostCommitEffects.wake(OutboxKind.SeriesAnalysis)),
      )

  test("a closed sink escalates runtime failure without changing the committed result"):
    for
      result <- Ref.of[IO, OcrJobCreationStore.OcrJobCreationResult](Right(()))
      sink <- RecordingSink.closed
      closed <- Ref.of[IO, Int](0)
      store = OutboxWakingRepositories.ocrJobCreation(
        ocrCreationStore(result),
        sink,
        closed.update(_ + 1),
      )
      actual <- store.store(ocrPlan)
      escalations <- closed.get
    yield
      assertEquals(actual, Right(()))
      assertEquals(escalations, 1)

  test("a failed remote analysis hint preserves the committed mutation result"):
    for
      updateResult <- Ref.of[IO, Either[AppError, Unit]](Right(()))
      deleteResult <- Ref.of[IO, Boolean](false)
      escalations <- Ref.of[IO, Int](0)
      repository = OutboxWakingRepositories.matches(
        matchesRepository(updateResult, deleteResult),
        FailingSink,
        escalations.update(_ + 1),
      )
      actual <- repository.update(matchRecord, now)
      escalationCount <- escalations.get
    yield
      assertEquals(actual, Right(()))
      assertEquals(escalationCount, 1)

  test("a failed durable operation emits no wake"):
    for
      sink <- RecordingSink.create
      closed <- Ref.of[IO, Int](0)
      repository = OutboxWakingRepositories.matches(
        failingMatchesRepository,
        sink,
        closed.update(_ + 1),
      )
      result <- repository.update(matchRecord, now).attempt
      effects <- sink.effects
    yield
      assert(result.isLeft)
      assertEquals(effects, Nil)

  private def ocrCreationStore(
      result: Ref[IO, OcrJobCreationStore.OcrJobCreationResult]
  ): OcrJobCreationStore[IO] = new OcrJobCreationStore[IO]:
    override def store(plan: OcrJobCreationPlan): IO[OcrJobCreationStore.OcrJobCreationResult] =
      result.get

  private def matchesRepository(
      updateResult: Ref[IO, Either[AppError, Unit]],
      deleteResult: Ref[IO, Boolean],
  ): MatchesRepository[IO] =
    new StubMatchesRepository:
      override def update(
          record: MatchRecord,
          updatedAt: Instant,
      ): IO[Either[AppError, Unit]] = updateResult.get
      override def delete(id: MatchId): IO[Boolean] = deleteResult.get

  private def failingMatchesRepository: MatchesRepository[IO] = new StubMatchesRepository:
    override def update(
        record: MatchRecord,
        updatedAt: Instant,
    ): IO[Either[AppError, Unit]] =
      IO.raiseError(new IllegalStateException("transaction rolled back"))

  private abstract class StubMatchesRepository extends MatchesRepository[IO]:
    override def update(
        record: MatchRecord,
        updatedAt: Instant,
    ): IO[Either[AppError, Unit]] = IO.pure(Right(()))
    override def delete(id: MatchId): IO[Boolean] = IO.pure(false)
    override def find(id: MatchId): IO[Option[MatchRecord]] = IO.pure(None)
    override def list(filter: MatchesRepository.ListFilter): IO[List[MatchRecord]] = IO.pure(Nil)
    override def listByHeldEvent(heldEventId: HeldEventId): IO[List[MatchRecord]] = IO.pure(Nil)
    override def existsMatchNo(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
    ): IO[Boolean] = IO.pure(false)
    override def existsMatchNoExcept(
        heldEventId: HeldEventId,
        matchNoInEvent: MatchNoInEvent,
        excludeMatchId: MatchId,
    ): IO[Boolean] = IO.pure(false)
    override def statsByHeldEvents(
        heldEventIds: List[HeldEventId]
    ): IO[Map[HeldEventId, MatchesRepository.HeldEventStats]] = IO.pure(Map.empty)

  private def confirmationRepository(
      result: Ref[IO, Either[AppError, MatchConfirmationResult]]
  ): MatchConfirmationRepository[IO] = new MatchConfirmationRepository[IO]:
    override def confirm(
        record: MatchRecord,
        draft: Option[MatchDraftConfirmation],
        updatedAt: Instant,
    ): IO[Either[AppError, MatchConfirmationResult]] = result.get

  private def seriesAnalysisRepository(
      result: Ref[IO, Either[AppError, SeriesAnalysisRecalculationAccepted]]
  ): SeriesAnalysisRepository[IO] = new SeriesAnalysisRepository[IO]:
    override def options: IO[Either[AppError, SeriesAnalysisOptions]] =
      IO.raiseError(new AssertionError("unused"))
    override def status(gameTitleId: GameTitleId): IO[Either[AppError, SeriesAnalysisStatus]] =
      IO.raiseError(new AssertionError("unused"))
    override def chunk(
        request: SeriesAnalysisChunkRequest
    ): IO[Either[AppError, SeriesAnalysisChunk]] = IO.raiseError(new AssertionError("unused"))
    override def adminOverview(
        gameTitleId: Option[GameTitleId]
    ): IO[Either[AppError, SeriesAnalysisAdminOverview]] =
      IO.raiseError(new AssertionError("unused"))
    override def requestTitleRecalculation(
        gameTitleId: GameTitleId,
        requestedBy: AccountId,
        idempotencyKeyHash: String,
    ): IO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = result.get
    override def requestAllRecalculation(
        requestedBy: AccountId,
        idempotencyKeyHash: String,
    ): IO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = result.get

  private def acceptedRecalculation = SeriesAnalysisRecalculationAccepted(
    requestId = "request-outbox-wake",
    acceptedAt = now,
    targetCount = 1,
    campaign = None,
    target = Some(SeriesAnalysisAcceptedTarget(titleId, Some("job-outbox-wake"), "queued")),
  )

  private def matchRecord = MatchFixtures.matchRecord(
    id = MatchId.unsafeFromString("match-outbox-wake"),
    heldEventId = HeldEventId.unsafeFromString("event-outbox-wake"),
    matchNoInEvent = 1,
    titleId = titleId,
    seasonId = SeasonMasterId.unsafeFromString("season-outbox-wake"),
    mapId = MapMasterId.unsafeFromString("map-outbox-wake"),
    playedAt = now,
    createdAt = now,
    memberValues = List("member-1", "member-2", "member-3", "member-4"),
    totalAssetsDraftId = None,
    revenueDraftId = None,
    incidentLogDraftId = None,
  )

  private def ocrPlan =
    val jobId = OcrJobId.unsafeFromString("job-outbox-wake")
    val draftId = OcrDraftId.unsafeFromString("draft-outbox-wake")
    val imageId = ImageId.unsafeFromString("image-outbox-wake")
    val imageLocation = StoredImageLocation.unsafeFromString("source-images/outbox-wake.png")
    val draft = OcrDraft(
      draftId,
      jobId,
      ScreenType.TotalAssets,
      None,
      None,
      "{}",
      "[]",
      "{}",
      now,
      now,
    )
    val job = OcrJob.Queued(
      jobId,
      draftId,
      imageId,
      imageLocation,
      ScreenType.TotalAssets,
      0,
      now,
      now,
    )
    val request = OcrJobEnqueueRequest(
      jobId,
      draftId,
      imageId,
      imageLocation,
      "a" * 64,
      1L,
      "image/png",
      ScreenType.TotalAssets,
      OcrJobEnqueueRequest.InitialAttempt,
      now,
      OcrJobHints.empty,
      None,
    )
    OcrJobCreationPlan(
      draft,
      job,
      None,
      OcrQueueDispatchIntent(request, None),
      12,
    )

  private final class RecordingSink private (
      ref: Ref[IO, List[PostCommitEffects]],
      result: OutboxWakeSubmitResult,
  ) extends OutboxWakeSink[IO]:
    override def submit(effects: PostCommitEffects): IO[OutboxWakeSubmitResult] =
      ref.update(_ :+ effects).as(result)

    def effects: IO[List[PostCommitEffects]] = ref.get

  private object RecordingSink:
    def create: IO[RecordingSink] =
      Ref.of[IO, List[PostCommitEffects]](Nil).map(
        new RecordingSink(_, OutboxWakeSubmitResult.Accepted)
      )

    def closed: IO[RecordingSink] =
      Ref.of[IO, List[PostCommitEffects]](Nil).map(
        new RecordingSink(_, OutboxWakeSubmitResult.Closed)
      )

  private object FailingSink extends OutboxWakeSink[IO]:
    override def submit(effects: PostCommitEffects): IO[OutboxWakeSubmitResult] =
      IO.raiseError(new IllegalStateException("notification connection unavailable"))

end OutboxWakingRepositoriesSpec
