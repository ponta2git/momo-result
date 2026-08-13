package momo.api.repositories

import java.time.Instant

import scala.concurrent.duration.DurationInt

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, Member, MemberAlias}

final class CachedReferenceRepositoriesSpec extends MomoCatsEffectSuite:
  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private val memberId = MemberId.unsafeFromString("ponta")
  private val userId = UserId.unsafeFromString("discord-ponta")
  private val member = Member(memberId, userId, "ponta", now)
  private val titleId = GameTitleId.unsafeFromString("momotetsu2")
  private val title = GameTitle(titleId, "桃鉄2", "momotetsu2", 1, now)
  private val aliasId = MemberAliasId.unsafeFromString("alias-1")
  private val alias = MemberAlias(aliasId, memberId, "ぽんた", now)

  test("members cache resolves list and find from a single delegate load"):
    for
      rows <- Ref.of[IO, List[Member]](List(member))
      listCalls <- Ref.of[IO, Int](0)
      delegate = CountingMembersRepository(rows, listCalls)
      cached <- CachedReferenceRepositories.members[IO](delegate, 1.hour)
      foundById <- cached.find(memberId)
      listed <- cached.list
      calls <- listCalls.get
    yield
      assertEquals(foundById, Some(member))
      assertEquals(listed, List(member))
      assertEquals(calls, 1)

  test("game title writes invalidate cached rows"):
    val renamed = title.copy(name = "桃鉄2改")
    for
      rows <- Ref.of[IO, List[GameTitle]](List(title))
      listCalls <- Ref.of[IO, Int](0)
      delegate = CountingGameTitlesRepository(rows, listCalls)
      cached <- CachedReferenceRepositories.gameTitles[IO](delegate, 1.hour)
      first <- cached.find(titleId)
      _ <- cached.find(titleId)
      beforeWriteCalls <- listCalls.get
      _ <- cached.update(renamed)
      second <- cached.find(titleId)
      afterWriteCalls <- listCalls.get
    yield
      assertEquals(first.map(_.name), Some("桃鉄2"))
      assertEquals(beforeWriteCalls, 1)
      assertEquals(second.map(_.name), Some("桃鉄2改"))
      assertEquals(afterWriteCalls, 2)

  test("member aliases cache filters from all aliases and invalidates after create"):
    val secondAlias = MemberAlias(MemberAliasId.unsafeFromString("alias-2"), memberId, "ponta", now)
    for
      rows <- Ref.of[IO, List[MemberAlias]](List(alias))
      listCalls <- Ref.of[IO, Int](0)
      delegate = CountingMemberAliasesRepository(rows, listCalls)
      cached <- CachedReferenceRepositories.memberAliases[IO](delegate, 1.hour)
      first <- cached.list(Some(memberId))
      _ <- cached.find(aliasId)
      beforeWriteCalls <- listCalls.get
      _ <- cached.create(secondAlias)
      second <- cached.list(Some(memberId))
      afterWriteCalls <- listCalls.get
    yield
      assertEquals(first, List(alias))
      assertEquals(beforeWriteCalls, 1)
      assertEquals(second, List(alias, secondAlias))
      assertEquals(afterWriteCalls, 2)

  private final class CountingMembersRepository(
      rows: Ref[IO, List[Member]],
      listCalls: Ref[IO, Int],
  ) extends MembersRepository[IO]:
    def list: IO[List[Member]] = listCalls.update(_ + 1) *> rows.get
    def find(id: MemberId): IO[Option[Member]] = rows.get.map(_.find(_.id == id))

  private object CountingMembersRepository:
    def apply(rows: Ref[IO, List[Member]], listCalls: Ref[IO, Int]): CountingMembersRepository =
      new CountingMembersRepository(rows, listCalls)

  private final class CountingGameTitlesRepository(
      rows: Ref[IO, List[GameTitle]],
      listCalls: Ref[IO, Int],
  ) extends GameTitlesRepository[IO]:
    def list: IO[List[GameTitle]] = listCalls.update(_ + 1) *> rows.get
    def find(id: GameTitleId): IO[Option[GameTitle]] = rows.get.map(_.find(_.id == id))
    def createWithNextDisplayOrder(title: GameTitle): IO[GameTitle] =
      rows.update(existing => existing :+ title).as(title)
    def update(title: GameTitle): IO[Unit] = rows.update(_.map(row =>
      if row.id == title.id then title else row
    ))
    def delete(id: GameTitleId): IO[Unit] = rows.update(_.filterNot(_.id == id))

  private object CountingGameTitlesRepository:
    def apply(
        rows: Ref[IO, List[GameTitle]],
        listCalls: Ref[IO, Int],
    ): CountingGameTitlesRepository = new CountingGameTitlesRepository(rows, listCalls)

  private final class CountingMemberAliasesRepository(
      rows: Ref[IO, List[MemberAlias]],
      listCalls: Ref[IO, Int],
  ) extends MemberAliasesRepository[IO]:
    def list(memberId: Option[MemberId]): IO[List[MemberAlias]] = listCalls.update(_ + 1) *>
      rows.get.map(all => memberId.fold(all)(id => all.filter(_.memberId == id)))
    def find(id: MemberAliasId): IO[Option[MemberAlias]] = rows.get.map(_.find(_.id == id))
    def create(alias: MemberAlias): IO[Unit] = rows.update(existing => existing :+ alias)
    def update(alias: MemberAlias): IO[Unit] = rows.update(_.map(row =>
      if row.id == alias.id then alias else row
    ))
    def delete(id: MemberAliasId): IO[Unit] = rows.update(_.filterNot(_.id == id))

  private object CountingMemberAliasesRepository:
    def apply(
        rows: Ref[IO, List[MemberAlias]],
        listCalls: Ref[IO, Int],
    ): CountingMemberAliasesRepository = new CountingMemberAliasesRepository(rows, listCalls)
