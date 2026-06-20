package momo.api.repositories

import cats.~>

import momo.api.domain.{
  SeriesComparisonMatchPlayerRow, SeriesComparisonOptionsData, SeriesComparisonResolvedScope,
  SeriesComparisonScope,
}

trait SeriesComparisonReadAlg[F0[_]]:
  def options: F0[SeriesComparisonOptionsData]
  def resolveScope(scope: SeriesComparisonScope): F0[Option[SeriesComparisonResolvedScope]]
  def loadRows(scope: SeriesComparisonResolvedScope): F0[List[SeriesComparisonMatchPlayerRow]]

trait SeriesComparisonReadModel[F[_]]:
  def options: F[SeriesComparisonOptionsData]
  def resolveScope(scope: SeriesComparisonScope): F[Option[SeriesComparisonResolvedScope]]
  def loadRows(scope: SeriesComparisonResolvedScope): F[List[SeriesComparisonMatchPlayerRow]]

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
