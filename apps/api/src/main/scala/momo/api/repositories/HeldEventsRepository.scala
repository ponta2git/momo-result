package momo.api.repositories

import cats.{~>, MonadThrow}

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, PageRequest, PagedResult}
import momo.api.errors.AppError

/** Usecase-facing facade: expected create rejections are values; unexpected failures remain in F. */
trait HeldEventsRepository[F[_]]:
  def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]]
  def listIds(query: Option[String]): F[List[HeldEventId]]
  def find(id: HeldEventId): F[Option[HeldEvent]]
  def create(event: HeldEvent): F[Either[AppError, Unit]]

object HeldEventsRepository:

  /** Postgres facade: lift each Alg op into `F` via the supplied tx boundary. */
  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: HeldEventsAlg[F0],
      liftK: F0 ~> F,
  ): HeldEventsRepository[F] =
    new HeldEventsRepository[F]:
      def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]] =
        liftK(alg.listPage(query, page))
      def listIds(query: Option[String]): F[List[HeldEventId]] = liftK(alg.listIds(query))
      def find(id: HeldEventId): F[Option[HeldEvent]] = liftK(alg.find(id))
      def create(event: HeldEvent): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.create(event)))

end HeldEventsRepository
