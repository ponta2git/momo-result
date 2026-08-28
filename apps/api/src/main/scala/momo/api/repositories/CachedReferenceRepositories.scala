package momo.api.repositories

import scala.concurrent.duration.{DurationInt, FiniteDuration}

import cats.effect.{Clock, Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, Member, MemberAlias, SeasonMaster}

private final case class ReferenceCacheEntry[A](loadedAt: FiniteDuration, value: A)
private final case class ReferenceCacheState[A](
    generation: Long,
    entry: Option[ReferenceCacheEntry[A]]
)

private final class ReferenceCache[F[_]: Clock: Sync, A](
    ref: Ref[F, ReferenceCacheState[A]],
    ttl: FiniteDuration,
    load: F[A],
):
  def get: F[A] =
    for
      now <- Clock[F].monotonic
      access <- ref.access
      (snapshot, store) = access
      value <- snapshot.entry match
        case Some(entry) if now - entry.loadedAt <= ttl => entry.value.pure[F]
        case _ => reload(snapshot, store)
    yield value

  def invalidate: F[Unit] = ref.update(state =>
    ReferenceCacheState(state.generation + 1L, entry = None)
  )

  def invalidateAfterSuccess[E, B](effect: F[Either[E, B]]): F[Either[E, B]] =
    Sync[F].uncancelable { poll =>
      // Cancellation can race a committed delegate write, so it invalidates conservatively.
      Sync[F].onCancel(poll(effect), invalidate)
        .flatTap(_.traverse_(_ => invalidate))
    }

  private def reload(
      snapshot: ReferenceCacheState[A],
      store: ReferenceCacheState[A] => F[Boolean],
  ): F[A] =
    for
      value <- load
      now <- Clock[F].monotonic
      stored <- store(snapshot.copy(entry = Some(ReferenceCacheEntry(now, value))))
      result <- if stored then value.pure[F] else get
    yield result

private object ReferenceCache:
  def create[F[_]: Clock: Sync, A](ttl: FiniteDuration, load: F[A]): F[ReferenceCache[F, A]] =
    Ref.of[F, ReferenceCacheState[A]](ReferenceCacheState(0L, None))
      .map(ref => ReferenceCache(ref, ttl, load))

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
      def createWithNextDisplayOrder(title: GameTitle) = cache
        .invalidateAfterSuccess(delegate.createWithNextDisplayOrder(title))
      def update(title: GameTitle) = cache.invalidateAfterSuccess(delegate.update(title))
      def delete(id: GameTitleId) = cache.invalidateAfterSuccess(delegate.delete(id))
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
      def createWithNextDisplayOrder(map: MapMaster) = cache
        .invalidateAfterSuccess(delegate.createWithNextDisplayOrder(map))
      def update(map: MapMaster) = cache.invalidateAfterSuccess(delegate.update(map))
      def delete(id: MapMasterId) = cache.invalidateAfterSuccess(delegate.delete(id))
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
      def createWithNextDisplayOrder(season: SeasonMaster) = cache
        .invalidateAfterSuccess(delegate.createWithNextDisplayOrder(season))
      def update(season: SeasonMaster) = cache.invalidateAfterSuccess(delegate.update(season))
      def delete(id: SeasonMasterId) = cache.invalidateAfterSuccess(delegate.delete(id))
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
      def create(alias: MemberAlias) = cache.invalidateAfterSuccess(delegate.create(alias))
      def update(alias: MemberAlias) = cache.invalidateAfterSuccess(delegate.update(alias))
      def delete(id: MemberAliasId) = cache.invalidateAfterSuccess(delegate.delete(id))
  }
end CachedReferenceRepositories
