package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

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
  def fromConnectionIO[F[_]](
      alg: HeldEventsAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): HeldEventsRepository[F] = new HeldEventsRepository[F]:
    def list(query: Option[String], limit: Int): F[List[HeldEvent]] =
      transactK(alg.list(query, limit))
    def listPage(query: Option[String], page: PageRequest): F[PagedResult[HeldEvent]] =
      transactK(alg.listPage(query, page))
    def listIds(query: Option[String]): F[List[HeldEventId]] = transactK(alg.listIds(query))
    def find(id: HeldEventId): F[Option[HeldEvent]] = transactK(alg.find(id))
    def create(event: HeldEvent): F[Unit] = transactK(alg.create(event))
    def delete(id: HeldEventId): F[Boolean] = transactK(alg.delete(id))

  /** InMemory facade: the algebra already runs in `F`, so the lift is identity. */
  def liftIdentity[F[_]](alg: HeldEventsAlg[F]): HeldEventsRepository[F] =
    new HeldEventsRepository[F]:
      export alg.*
end HeldEventsRepository
