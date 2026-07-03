package momo.api.repositories

import scala.concurrent.duration.{DurationInt, FiniteDuration}

import cats.effect.{Clock, Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, Member, MemberAlias, SeasonMaster}

private final case class ReferenceCacheEntry[A](loadedAt: FiniteDuration, value: A)

private final class ReferenceCache[F[_]: Clock: Sync, A](
    ref: Ref[F, Option[ReferenceCacheEntry[A]]],
    ttl: FiniteDuration,
    load: F[A],
):
  def get: F[A] =
    for
      now <- Clock[F].monotonic
      cached <- ref.get
      value <- cached match
        case Some(entry) if now - entry.loadedAt <= ttl => entry.value.pure[F]
        case _ => reload
    yield value

  def invalidate: F[Unit] = ref.set(None)

  private def reload: F[A] =
    for
      value <- load
      now <- Clock[F].monotonic
      _ <- ref.set(Some(ReferenceCacheEntry(now, value)))
    yield value

private object ReferenceCache:
  def create[F[_]: Clock: Sync, A](ttl: FiniteDuration, load: F[A]): F[ReferenceCache[F, A]] =
    Ref.of[F, Option[ReferenceCacheEntry[A]]](None).map(ref => ReferenceCache(ref, ttl, load))

object CachedReferenceRepositories:
  val DefaultTtl: FiniteDuration = 30.seconds

  def members[F[_]: Clock: Sync](delegate: MembersRepository[F]): F[MembersRepository[F]] =
    members(delegate, DefaultTtl)

  def members[F[_]: Clock: Sync](
      delegate: MembersRepository[F],
      ttl: FiniteDuration,
  ): F[MembersRepository[F]] = ReferenceCache.create(ttl, delegate.list).map { cache =>
    new MembersRepository[F]:
      def list: F[List[Member]] = cache.get
      def find(id: MemberId): F[Option[Member]] = cache.get.map(_.find(_.id == id))
      def findByDiscordUserId(userId: UserId): F[Option[Member]] =
        cache.get.map(_.find(_.userId == userId))
  }

  def gameTitles[F[_]: Clock: Sync](
      delegate: GameTitlesRepository[F]
  ): F[GameTitlesRepository[F]] = gameTitles(delegate, DefaultTtl)

  def gameTitles[F[_]: Clock: Sync](
      delegate: GameTitlesRepository[F],
      ttl: FiniteDuration,
  ): F[GameTitlesRepository[F]] = ReferenceCache.create(ttl, delegate.list).map { cache =>
    new GameTitlesRepository[F]:
      def list: F[List[GameTitle]] = cache.get
      def find(id: GameTitleId): F[Option[GameTitle]] = cache.get.map(_.find(_.id == id))
      def create(title: GameTitle): F[Unit] = delegate.create(title) <* cache.invalidate
      def createWithNextDisplayOrder(title: GameTitle): F[GameTitle] =
        delegate.createWithNextDisplayOrder(title) <* cache.invalidate
      def update(title: GameTitle): F[Unit] = delegate.update(title) <* cache.invalidate
      def delete(id: GameTitleId): F[Unit] = delegate.delete(id) <* cache.invalidate
  }

  def mapMasters[F[_]: Clock: Sync](
      delegate: MapMastersRepository[F]
  ): F[MapMastersRepository[F]] = mapMasters(delegate, DefaultTtl)

  def mapMasters[F[_]: Clock: Sync](
      delegate: MapMastersRepository[F],
      ttl: FiniteDuration,
  ): F[MapMastersRepository[F]] = ReferenceCache.create(ttl, delegate.list(None)).map { cache =>
    new MapMastersRepository[F]:
      def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] =
        cache.get.map(rows => gameTitleId.fold(rows)(id => rows.filter(_.gameTitleId == id)))
      def find(id: MapMasterId): F[Option[MapMaster]] = cache.get.map(_.find(_.id == id))
      def create(map: MapMaster): F[Unit] = delegate.create(map) <* cache.invalidate
      def createWithNextDisplayOrder(map: MapMaster): F[MapMaster] =
        delegate.createWithNextDisplayOrder(map) <* cache.invalidate
      def update(map: MapMaster): F[Unit] = delegate.update(map) <* cache.invalidate
      def delete(id: MapMasterId): F[Unit] = delegate.delete(id) <* cache.invalidate
  }

  def seasonMasters[F[_]: Clock: Sync](
      delegate: SeasonMastersRepository[F]
  ): F[SeasonMastersRepository[F]] = seasonMasters(delegate, DefaultTtl)

  def seasonMasters[F[_]: Clock: Sync](
      delegate: SeasonMastersRepository[F],
      ttl: FiniteDuration,
  ): F[SeasonMastersRepository[F]] = ReferenceCache.create(ttl, delegate.list(None)).map { cache =>
    new SeasonMastersRepository[F]:
      def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] =
        cache.get.map(rows => gameTitleId.fold(rows)(id => rows.filter(_.gameTitleId == id)))
      def find(id: SeasonMasterId): F[Option[SeasonMaster]] = cache.get.map(_.find(_.id == id))
      def create(season: SeasonMaster): F[Unit] = delegate.create(season) <* cache.invalidate
      def createWithNextDisplayOrder(season: SeasonMaster): F[SeasonMaster] =
        delegate.createWithNextDisplayOrder(season) <* cache.invalidate
      def update(season: SeasonMaster): F[Unit] = delegate.update(season) <* cache.invalidate
      def delete(id: SeasonMasterId): F[Unit] = delegate.delete(id) <* cache.invalidate
  }

  def incidentMasters[F[_]: Clock: Sync](
      delegate: IncidentMastersRepository[F]
  ): F[IncidentMastersRepository[F]] = incidentMasters(delegate, DefaultTtl)

  def incidentMasters[F[_]: Clock: Sync](
      delegate: IncidentMastersRepository[F],
      ttl: FiniteDuration,
  ): F[IncidentMastersRepository[F]] = ReferenceCache.create(ttl, delegate.list).map { cache =>
    new IncidentMastersRepository[F]:
      def list: F[List[IncidentMaster]] = cache.get
  }

  def memberAliases[F[_]: Clock: Sync](
      delegate: MemberAliasesRepository[F]
  ): F[MemberAliasesRepository[F]] = memberAliases(delegate, DefaultTtl)

  def memberAliases[F[_]: Clock: Sync](
      delegate: MemberAliasesRepository[F],
      ttl: FiniteDuration,
  ): F[MemberAliasesRepository[F]] = ReferenceCache.create(ttl, delegate.list(None)).map { cache =>
    new MemberAliasesRepository[F]:
      def list(memberId: Option[MemberId]): F[List[MemberAlias]] =
        cache.get.map(rows => memberId.fold(rows)(id => rows.filter(_.memberId == id)))
      def find(id: MemberAliasId): F[Option[MemberAlias]] = cache.get.map(_.find(_.id == id))
      def create(alias: MemberAlias): F[Unit] = delegate.create(alias) <* cache.invalidate
      def update(alias: MemberAlias): F[Unit] = delegate.update(alias) <* cache.invalidate
      def delete(id: MemberAliasId): F[Unit] = delegate.delete(id) <* cache.invalidate
  }
end CachedReferenceRepositories
