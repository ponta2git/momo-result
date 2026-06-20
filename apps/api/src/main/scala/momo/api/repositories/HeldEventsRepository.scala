package momo.api.repositories

import cats.~>

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, PageRequest, PagedResult}

trait HeldEventsRepository[F[_]]:
  def list(query: Option[String], limit: Int): F[List[HeldEvent]]
  def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]]
  def listIds(query: Option[String]): F[List[HeldEventId]]
  def find(id: HeldEventId): F[Option[HeldEvent]]
  def create(event: HeldEvent): F[Unit]
  def delete(id: HeldEventId): F[Boolean]

object HeldEventsRepository:

  /** Postgres facade: lift each Alg op into `F` via the supplied tx boundary. */
  def fromAlg[F0[_], F[_]](alg: HeldEventsAlg[F0], liftK: F0 ~> F): HeldEventsRepository[F] =
    new HeldEventsRepository[F]:
      def list(query: Option[String], limit: Int): F[List[HeldEvent]] =
        liftK(alg.list(query, limit))
      def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]] =
        liftK(alg.listPage(query, page))
      def listIds(query: Option[String]): F[List[HeldEventId]] = liftK(alg.listIds(query))
      def find(id: HeldEventId): F[Option[HeldEvent]] = liftK(alg.find(id))
      def create(event: HeldEvent): F[Unit] = liftK(alg.create(event))
      def delete(id: HeldEventId): F[Boolean] = liftK(alg.delete(id))

  /** InMemory facade: the algebra already runs in `F`, so the lift is identity. */
  def liftIdentity[F[_]](alg: HeldEventsAlg[F]): HeldEventsRepository[F] =
    new HeldEventsRepository[F]:
      export alg.*
end HeldEventsRepository
