package momo.api.repositories

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*
import cats.~>

import momo.api.domain.{
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonOptionsData,
  SeriesComparisonResolvedScope,
  SeriesComparisonScope
}

final case class SeriesComparisonDataVersion(
    matchCount: Int,
    latestMatchUpdatedAt: Option[Instant],
) derives CanEqual

trait SeriesComparisonReadAlg[F0[_]]:
  def options: F0[SeriesComparisonOptionsData]
  def resolveScope(scope: SeriesComparisonScope): F0[Option[SeriesComparisonResolvedScope]]
  def loadRows(scope: SeriesComparisonResolvedScope): F0[List[SeriesComparisonMatchPlayerRow]]

trait SeriesComparisonReadModel[F[_]]:
  def options: F[SeriesComparisonOptionsData]
  def resolveScope(scope: SeriesComparisonScope): F[Option[SeriesComparisonResolvedScope]]
  def loadRows(scope: SeriesComparisonResolvedScope): F[List[SeriesComparisonMatchPlayerRow]]

trait VersionedSeriesComparisonReadModel[F[_]] extends SeriesComparisonReadModel[F]:
  def dataVersion(scope: SeriesComparisonResolvedScope): F[SeriesComparisonDataVersion]

object SeriesComparisonReadModel:
  def fromAlg[F0[_], F[_]](
      alg: SeriesComparisonReadAlg[F0],
      liftK: F0 ~> F,
  ): SeriesComparisonReadModel[F] = new SeriesComparisonReadModel[F]:
    def options: F[SeriesComparisonOptionsData] = liftK(alg.options)
    def resolveScope(scope: SeriesComparisonScope): F[Option[SeriesComparisonResolvedScope]] =
      liftK(alg.resolveScope(scope))
    def loadRows(scope: SeriesComparisonResolvedScope): F[List[SeriesComparisonMatchPlayerRow]] =
      liftK(alg.loadRows(scope))

  def liftIdentity[F[_]](alg: SeriesComparisonReadAlg[F]): SeriesComparisonReadModel[F] =
    new SeriesComparisonReadModel[F]:
      export alg.*

object CachedSeriesComparisonReadModel:
  private final case class ScopeKey(
      gameTitleId: String,
      seasonMasterId: Option[String],
      mapMasterId: Option[String],
  ) derives CanEqual

  private final case class CacheKey(
      scope: ScopeKey,
      version: SeriesComparisonDataVersion,
  ) derives CanEqual

  private final case class State(
      rows: Map[CacheKey, List[SeriesComparisonMatchPlayerRow]],
      order: Vector[CacheKey],
  )

  private object State:
    val empty: State = State(Map.empty, Vector.empty)

  def create[F[_]: Sync](
      delegate: VersionedSeriesComparisonReadModel[F]
  ): F[SeriesComparisonReadModel[F]] = create(delegate, maxEntries = 32)

  def create[F[_]: Sync](
      delegate: VersionedSeriesComparisonReadModel[F],
      maxEntries: Int,
  ): F[SeriesComparisonReadModel[F]] = Ref
    .of[F, State](State.empty).map(ref => new Cached(delegate, ref, maxEntries.max(1)))

  private final class Cached[F[_]: Sync](
      delegate: VersionedSeriesComparisonReadModel[F],
      ref: Ref[F, State],
      maxEntries: Int,
  ) extends SeriesComparisonReadModel[F]:
    override def options: F[SeriesComparisonOptionsData] = delegate.options

    override def resolveScope(
        scope: SeriesComparisonScope
    ): F[Option[SeriesComparisonResolvedScope]] = delegate.resolveScope(scope)

    override def loadRows(
        scope: SeriesComparisonResolvedScope
    ): F[List[SeriesComparisonMatchPlayerRow]] =
      delegate.dataVersion(scope).flatMap { version =>
        val key = CacheKey(scopeKey(scope), version)
        ref.get.flatMap(_.rows.get(key) match
          case Some(rows) => rows.pure[F]
          case None => delegate.loadRows(scope).flatTap(rows => ref.update(put(key, rows))))
      }

    private def put(
        key: CacheKey,
        rows: List[SeriesComparisonMatchPlayerRow],
    )(state: State): State =
      val withoutKey = state.order.filterNot(_ == key)
      val appended = withoutKey :+ key
      val retained = appended.takeRight(maxEntries)
      val retainedSet = retained.toSet
      State(
        rows = (state.rows + (key -> rows)).filter { case (cacheKey, _) => retainedSet(cacheKey) },
        order = retained,
      )

    private def scopeKey(scope: SeriesComparisonResolvedScope): ScopeKey = ScopeKey(
      gameTitleId = scope.gameTitleId.value,
      seasonMasterId = scope.seasonMasterId.map(_.value),
      mapMasterId = scope.mapMasterId.map(_.value),
    )
