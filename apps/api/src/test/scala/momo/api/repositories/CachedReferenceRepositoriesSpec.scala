package momo.api.repositories

import java.time.Instant

import scala.concurrent.duration.DurationInt

import cats.effect.{Deferred, IO, Ref}
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, Member, MemberAlias}
import momo.api.errors.AppError

final class CachedReferenceRepositoriesSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private val memberId = MemberId.unsafeFromString("ponta")
  private val userId = UserId.unsafeFromString("discord-ponta")
  private val member = Member(memberId, userId, "ponta", now)
  private val titleId = GameTitleId.unsafeFromString("momotetsu2")
  private val title = GameTitle(titleId, "桃鉄2", "momotetsu2", 1, now)
  private val aliasId = MemberAliasId.unsafeFromString("alias-1")
  private val alias = MemberAlias(aliasId, memberId, "ぽんた", now)

  test("member detail remains available when the complete catalog cannot be loaded"):
    for
      rows <- Ref.of[IO, List[Member]](List(member))
      delegate = new MembersRepository[IO]:
        def list = IO.raiseError(new IllegalStateException("catalog unavailable"))
        def find(id: MemberId) = rows.get.map(_.find(_.id == id))
      cached <- CachedReferenceRepositories.members[IO](delegate, 1.hour)
      foundById <- cached.find(memberId)
      listed <- cached.list.attempt
    yield
      assertEquals(foundById, Some(member))
      assert(listed.isLeft)

  test("concurrent cache misses share one successful delegate load"):
    for
      calls <- Ref.of[IO, Int](0)
      started <- Deferred[IO, Unit]
      release <- Deferred[IO, Unit]
      delegate = new MembersRepository[IO]:
        def list = calls.update(_ + 1) *> started.complete(()).void *> release.get.as(List(member))
        def find(id: MemberId) = list.map(_.find(_.id == id))
      cached <- CachedReferenceRepositories.members[IO](delegate, 1.hour)
      readers <- List.fill(12)(cached.list.start).sequence
      _ <- started.get
      _ <- release.complete(())
      results <- readers.traverse(_.joinWithNever)
      count <- calls.get
    yield
      assertEquals(results, List.fill(12)(List(member)))
      assertEquals(count, 1)

  test("cancelling the reload owner lets another reader populate the cache"):
    for
      calls <- Ref.of[IO, Int](0)
      started <- Deferred[IO, Unit]
      delegate = new MembersRepository[IO]:
        def list = calls.getAndUpdate(_ + 1).flatMap {
          case 0 => started.complete(()).void *> IO.never[List[Member]]
          case _ => IO.pure(List(member))
        }
        def find(id: MemberId) = list.map(_.find(_.id == id))
      cached <- CachedReferenceRepositories.members[IO](delegate, 1.hour)
      owner <- cached.list.start
      _ <- started.get
      waiter <- cached.list.start
      _ <- owner.cancel
      result <- waiter.joinWithNever
      cachedResult <- cached.list
      count <- calls.get
    yield
      assertEquals(result, List(member))
      assertEquals(cachedResult, result)
      assertEquals(count, 2)

  test("game title writes invalidate cached rows"):
    val renamed = title.copy(name = "桃鉄2改")
    for
      rows <- Ref.of[IO, List[GameTitle]](List(title))
      listCalls <- Ref.of[IO, Int](0)
      delegate = CountingGameTitlesRepository(rows, listCalls)
      cached <- CachedReferenceRepositories.gameTitles[IO](delegate, 1.hour)
      first <- cached.list.map(_.headOption)
      _ <- cached.list.map(_.headOption)
      beforeWriteCalls <- listCalls.get
      _ <- cached.update(renamed)
      second <- cached.list.map(_.headOption)
      afterWriteCalls <- listCalls.get
    yield
      assertEquals(first.map(_.name), Some("桃鉄2"))
      assertEquals(beforeWriteCalls, 1)
      assertEquals(second.map(_.name), Some("桃鉄2改"))
      assertEquals(afterWriteCalls, 2)

  test("a reload racing with a successful write cannot restore stale rows"):
    val renamed = title.copy(name = "桃鉄2改")
    for
      rows <- Ref.of[IO, List[GameTitle]](List(title))
      listCalls <- Ref.of[IO, Int](0)
      snapshotTaken <- Deferred[IO, Unit]
      releaseSnapshot <- Deferred[IO, Unit]
      delegate = RacingGameTitlesRepository(rows, listCalls, snapshotTaken, releaseSnapshot)
      cached <- CachedReferenceRepositories.gameTitles[IO](delegate, 1.hour)
      loading <- cached.list.map(_.headOption).start
      _ <- snapshotTaken.get
      updated <- cached.update(renamed)
      _ <- releaseSnapshot.complete(())
      found <- loading.joinWithNever
      calls <- listCalls.get
    yield
      assertEquals(updated, Right(()))
      assertEquals(found.map(_.name), Some("桃鉄2改"))
      assertEquals(calls, 2)

  test("a rejected write keeps the current cache entry"):
    val rejection = AppError.Conflict("duplicate title")
    for
      rows <- Ref.of[IO, List[GameTitle]](List(title))
      listCalls <- Ref.of[IO, Int](0)
      delegate = new CountingGameTitlesRepository(rows, listCalls):
        override def update(title: GameTitle): IO[Either[AppError, Unit]] = IO.pure(Left(rejection))
      cached <- CachedReferenceRepositories.gameTitles[IO](delegate, 1.hour)
      _ <- cached.list.map(_.headOption)
      result <- cached.update(title.copy(name = "ignored"))
      second <- cached.list.map(_.headOption)
      calls <- listCalls.get
    yield
      assertEquals(result, Left(rejection))
      assertEquals(second, Some(title))
      assertEquals(calls, 1)

  test("cancellation after a delegate write cannot preserve stale cached rows"):
    val renamed = title.copy(name = "桃鉄2改")
    for
      rows <- Ref.of[IO, List[GameTitle]](List(title))
      listCalls <- Ref.of[IO, Int](0)
      writeCommitted <- Deferred[IO, Unit]
      awaitCancellation <- Deferred[IO, Unit]
      delegate = new CountingGameTitlesRepository(rows, listCalls):
        override def update(title: GameTitle): IO[Either[AppError, Unit]] = rows
          .update(_.map(row => if row.id == title.id then title else row)) *>
          writeCommitted.complete(()).void *> awaitCancellation.get.as(Right(()))
      cached <- CachedReferenceRepositories.gameTitles[IO](delegate, 1.hour)
      _ <- cached.list.map(_.headOption)
      updating <- cached.update(renamed).start
      _ <- writeCommitted.get
      _ <- updating.cancel
      found <- cached.list.map(_.headOption)
      calls <- listCalls.get
    yield
      assertEquals(found.map(_.name), Some("桃鉄2改"))
      assertEquals(calls, 2)

  test("member alias catalog invalidates after create"):
    val secondAlias = MemberAlias(MemberAliasId.unsafeFromString("alias-2"), memberId, "ponta", now)
    for
      rows <- Ref.of[IO, List[MemberAlias]](List(alias))
      listCalls <- Ref.of[IO, Int](0)
      delegate = CountingMemberAliasesRepository(rows, listCalls)
      cached <- CachedReferenceRepositories.memberAliases[IO](delegate, 1.hour)
      first <- cached.list(None)
      _ <- cached.find(aliasId)
      beforeWriteCalls <- listCalls.get
      _ <- cached.create(secondAlias)
      second <- cached.list(None)
      afterWriteCalls <- listCalls.get
    yield
      assertEquals(first, List(alias))
      assertEquals(beforeWriteCalls, 1)
      assertEquals(second, List(alias, secondAlias))
      assertEquals(afterWriteCalls, 2)

  test("filtered aliases and single records do not depend on the full catalog budget"):
    for
      rows <- Ref.of[IO, List[MemberAlias]](List(alias))
      delegate = new MemberAliasesRepository[IO]:
        def list(id: Option[MemberId]) = id match
          case None => IO.raiseError(new IllegalStateException("catalog exceeds budget"))
          case Some(value) => rows.get.map(_.filter(_.memberId == value))
        def find(id: MemberAliasId) = rows.get.map(_.find(_.id == id))
        def create(value: MemberAlias) = rows.update(_ :+ value).as(Right(()))
        def update(value: MemberAlias) = rows.set(List(value)).as(Right(()))
        def delete(id: MemberAliasId) = rows.update(_.filterNot(_.id == id)).as(Right(()))
      cached <- CachedReferenceRepositories.memberAliases[IO](delegate, 1.hour)
      all <- cached.list(None).attempt
      filtered <- cached.list(Some(memberId))
      found <- cached.find(aliasId)
      deleted <- cached.delete(aliasId)
      after <- cached.find(aliasId)
    yield
      assert(all.isLeft)
      assertEquals(filtered, List(alias))
      assertEquals(found, Some(alias))
      assertEquals(deleted, Right(()))
      assertEquals(after, None)

  test("a lost write response cannot preserve cached rows from before the commit"):
    val renamed = title.copy(name = "桃鉄2改")
    val connectionLost = new java.io.IOException("commit response lost")
    for
      rows <- Ref.of[IO, List[GameTitle]](List(title))
      listCalls <- Ref.of[IO, Int](0)
      delegate = new CountingGameTitlesRepository(rows, listCalls):
        override def update(value: GameTitle): IO[Either[AppError, Unit]] =
          rows.set(List(value)) *> IO.raiseError(connectionLost)
      cached <- CachedReferenceRepositories.gameTitles[IO](delegate, 1.hour)
      before <- cached.list.map(_.headOption)
      result <- cached.update(renamed).attempt
      after <- cached.list.map(_.headOption)
    yield
      assertEquals(before, Some(title))
      assertEquals(result, Left(connectionLost))
      assertEquals(after, Some(renamed))

  private class CountingGameTitlesRepository(
      rows: Ref[IO, List[GameTitle]],
      listCalls: Ref[IO, Int],
  ) extends GameTitlesRepository[IO]:
    def list: IO[List[GameTitle]] = listCalls.update(_ + 1) *> rows.get
    def find(id: GameTitleId): IO[Option[GameTitle]] = rows.get.map(_.find(_.id == id))
    def createWithNextDisplayOrder(title: GameTitle): IO[Either[AppError, GameTitle]] =
      rows.update(existing => existing :+ title).as(Right(title))
    def update(title: GameTitle): IO[Either[AppError, Unit]] = rows.update(_.map(row =>
      if row.id == title.id then title else row
    )).as(Right(()))
    def delete(id: GameTitleId): IO[Either[AppError, Unit]] = rows
      .update(_.filterNot(_.id == id)).as(Right(()))

  private object CountingGameTitlesRepository:
    def apply(
        rows: Ref[IO, List[GameTitle]],
        listCalls: Ref[IO, Int],
    ): CountingGameTitlesRepository = new CountingGameTitlesRepository(rows, listCalls)

  private final class RacingGameTitlesRepository(
      rows: Ref[IO, List[GameTitle]],
      listCalls: Ref[IO, Int],
      snapshotTaken: Deferred[IO, Unit],
      releaseSnapshot: Deferred[IO, Unit],
  ) extends CountingGameTitlesRepository(rows, listCalls):
    override def list: IO[List[GameTitle]] =
      for
        _ <- listCalls.update(_ + 1)
        snapshot <- rows.get
        _ <- snapshotTaken.complete(()).void
        _ <- releaseSnapshot.get
      yield snapshot

  private object RacingGameTitlesRepository:
    def apply(
        rows: Ref[IO, List[GameTitle]],
        listCalls: Ref[IO, Int],
        snapshotTaken: Deferred[IO, Unit],
        releaseSnapshot: Deferred[IO, Unit],
    ): RacingGameTitlesRepository =
      new RacingGameTitlesRepository(rows, listCalls, snapshotTaken, releaseSnapshot)

  private final class CountingMemberAliasesRepository(
      rows: Ref[IO, List[MemberAlias]],
      listCalls: Ref[IO, Int],
  ) extends MemberAliasesRepository[IO]:
    def list(memberId: Option[MemberId]): IO[List[MemberAlias]] = listCalls.update(_ + 1) *>
      rows.get.map(all => memberId.fold(all)(id => all.filter(_.memberId == id)))
    def find(id: MemberAliasId): IO[Option[MemberAlias]] = rows.get.map(_.find(_.id == id))
    def create(alias: MemberAlias): IO[Either[AppError, Unit]] = rows
      .update(existing => existing :+ alias).as(Right(()))
    def update(alias: MemberAlias): IO[Either[AppError, Unit]] = rows.update(_.map(row =>
      if row.id == alias.id then alias else row
    )).as(Right(()))
    def delete(id: MemberAliasId): IO[Either[AppError, Unit]] = rows
      .update(_.filterNot(_.id == id)).as(Right(()))

  private object CountingMemberAliasesRepository:
    def apply(
        rows: Ref[IO, List[MemberAlias]],
        listCalls: Ref[IO, Int],
    ): CountingMemberAliasesRepository = new CountingMemberAliasesRepository(rows, listCalls)
