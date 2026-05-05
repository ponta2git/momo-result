package momo.api.repositories

import cats.~>
import doobie.ConnectionIO

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}

trait GameTitlesAlg[F0[_]]:
  def list: F0[List[GameTitle]]
  def find(id: GameTitleId): F0[Option[GameTitle]]
  def create(title: GameTitle): F0[Unit]
  def nextDisplayOrder: F0[Int]

trait GameTitlesRepository[F[_]]:
  def list: F[List[GameTitle]]
  def find(id: GameTitleId): F[Option[GameTitle]]
  def create(title: GameTitle): F[Unit]
  def nextDisplayOrder: F[Int]

object GameTitlesRepository:
  def fromConnectionIO[F[_]](
      alg: GameTitlesAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): GameTitlesRepository[F] = new GameTitlesRepository[F]:
    def list: F[List[GameTitle]] = transactK(alg.list)
    def find(id: GameTitleId): F[Option[GameTitle]] = transactK(alg.find(id))
    def create(title: GameTitle): F[Unit] = transactK(alg.create(title))
    def nextDisplayOrder: F[Int] = transactK(alg.nextDisplayOrder)

  def liftIdentity[F[_]](alg: GameTitlesAlg[F]): GameTitlesRepository[F] =
    new GameTitlesRepository[F]:
      export alg.*
end GameTitlesRepository

trait MapMastersAlg[F0[_]]:
  def list(gameTitleId: Option[GameTitleId]): F0[List[MapMaster]]
  def find(id: MapMasterId): F0[Option[MapMaster]]
  def create(map: MapMaster): F0[Unit]
  def nextDisplayOrder(gameTitleId: GameTitleId): F0[Int]

trait MapMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]]
  def find(id: MapMasterId): F[Option[MapMaster]]
  def create(map: MapMaster): F[Unit]
  def nextDisplayOrder(gameTitleId: GameTitleId): F[Int]

object MapMastersRepository:
  def fromConnectionIO[F[_]](
      alg: MapMastersAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MapMastersRepository[F] = new MapMastersRepository[F]:
    def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] =
      transactK(alg.list(gameTitleId))
    def find(id: MapMasterId): F[Option[MapMaster]] = transactK(alg.find(id))
    def create(map: MapMaster): F[Unit] = transactK(alg.create(map))
    def nextDisplayOrder(gameTitleId: GameTitleId): F[Int] =
      transactK(alg.nextDisplayOrder(gameTitleId))

  def liftIdentity[F[_]](alg: MapMastersAlg[F]): MapMastersRepository[F] =
    new MapMastersRepository[F]:
      export alg.*
end MapMastersRepository

trait SeasonMastersAlg[F0[_]]:
  def list(gameTitleId: Option[GameTitleId]): F0[List[SeasonMaster]]
  def find(id: SeasonMasterId): F0[Option[SeasonMaster]]
  def create(season: SeasonMaster): F0[Unit]
  def nextDisplayOrder(gameTitleId: GameTitleId): F0[Int]

trait SeasonMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]]
  def find(id: SeasonMasterId): F[Option[SeasonMaster]]
  def create(season: SeasonMaster): F[Unit]
  def nextDisplayOrder(gameTitleId: GameTitleId): F[Int]

object SeasonMastersRepository:
  def fromConnectionIO[F[_]](
      alg: SeasonMastersAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): SeasonMastersRepository[F] = new SeasonMastersRepository[F]:
    def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] =
      transactK(alg.list(gameTitleId))
    def find(id: SeasonMasterId): F[Option[SeasonMaster]] = transactK(alg.find(id))
    def create(season: SeasonMaster): F[Unit] = transactK(alg.create(season))
    def nextDisplayOrder(gameTitleId: GameTitleId): F[Int] =
      transactK(alg.nextDisplayOrder(gameTitleId))

  def liftIdentity[F[_]](alg: SeasonMastersAlg[F]): SeasonMastersRepository[F] =
    new SeasonMastersRepository[F]:
      export alg.*
end SeasonMastersRepository

trait IncidentMastersAlg[F0[_]]:
  def list: F0[List[IncidentMaster]]

trait IncidentMastersRepository[F[_]]:
  def list: F[List[IncidentMaster]]

object IncidentMastersRepository:
  def fromConnectionIO[F[_]](
      alg: IncidentMastersAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): IncidentMastersRepository[F] = new IncidentMastersRepository[F]:
    def list: F[List[IncidentMaster]] = transactK(alg.list)

  def liftIdentity[F[_]](alg: IncidentMastersAlg[F]): IncidentMastersRepository[F] =
    new IncidentMastersRepository[F]:
      export alg.*
end IncidentMastersRepository

trait MemberAliasesAlg[F0[_]]:
  def list(memberId: Option[MemberId]): F0[List[MemberAlias]]
  def create(id: String, alias: MemberAlias): F0[Unit]

trait MemberAliasesRepository[F[_]]:
  def list(memberId: Option[MemberId]): F[List[MemberAlias]]
  def create(alias: MemberAlias): F[Unit]

trait MembersAlg[F0[_]]:
  def list: F0[List[momo.api.domain.Member]]
  def find(id: MemberId): F0[Option[momo.api.domain.Member]]
  def findByDiscordUserId(userId: UserId): F0[Option[momo.api.domain.Member]]

trait MembersRepository[F[_]]:
  def list: F[List[momo.api.domain.Member]]
  def find(id: MemberId): F[Option[momo.api.domain.Member]]
  def findByDiscordUserId(userId: UserId): F[Option[momo.api.domain.Member]]

object MembersRepository:
  def fromConnectionIO[F[_]](
      alg: MembersAlg[ConnectionIO],
      transactK: ConnectionIO ~> F,
  ): MembersRepository[F] = new MembersRepository[F]:
    def list: F[List[momo.api.domain.Member]] = transactK(alg.list)
    def find(id: MemberId): F[Option[momo.api.domain.Member]] = transactK(alg.find(id))
    def findByDiscordUserId(userId: UserId): F[Option[momo.api.domain.Member]] =
      transactK(alg.findByDiscordUserId(userId))

  def liftIdentity[F[_]](alg: MembersAlg[F]): MembersRepository[F] = new MembersRepository[F]:
    export alg.*
end MembersRepository
