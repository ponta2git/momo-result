package momo.api.repositories

import cats.~>

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}

trait GameTitlesAlg[F0[_]]:
  def list: F0[List[GameTitle]]
  def find(id: GameTitleId): F0[Option[GameTitle]]
  def create(title: GameTitle): F0[Unit]
  def createWithNextDisplayOrder(title: GameTitle): F0[GameTitle]
  def update(title: GameTitle): F0[Unit]
  def delete(id: GameTitleId): F0[Unit]

trait GameTitlesRepository[F[_]]:
  def list: F[List[GameTitle]]
  def find(id: GameTitleId): F[Option[GameTitle]]
  def create(title: GameTitle): F[Unit]
  def createWithNextDisplayOrder(title: GameTitle): F[GameTitle]
  def update(title: GameTitle): F[Unit]
  def delete(id: GameTitleId): F[Unit]

object GameTitlesRepository:
  def fromAlg[F0[_], F[_]](alg: GameTitlesAlg[F0], liftK: F0 ~> F): GameTitlesRepository[F] =
    new GameTitlesRepository[F]:
      def list: F[List[GameTitle]] = liftK(alg.list)
      def find(id: GameTitleId): F[Option[GameTitle]] = liftK(alg.find(id))
      def create(title: GameTitle): F[Unit] = liftK(alg.create(title))
      def createWithNextDisplayOrder(title: GameTitle): F[GameTitle] =
        liftK(alg.createWithNextDisplayOrder(title))
      def update(title: GameTitle): F[Unit] = liftK(alg.update(title))
      def delete(id: GameTitleId): F[Unit] = liftK(alg.delete(id))

  def liftIdentity[F[_]](alg: GameTitlesAlg[F]): GameTitlesRepository[F] =
    new GameTitlesRepository[F]:
      export alg.*
end GameTitlesRepository

trait MapMastersAlg[F0[_]]:
  def list(gameTitleId: Option[GameTitleId]): F0[List[MapMaster]]
  def find(id: MapMasterId): F0[Option[MapMaster]]
  def create(map: MapMaster): F0[Unit]
  def createWithNextDisplayOrder(map: MapMaster): F0[MapMaster]
  def update(map: MapMaster): F0[Unit]
  def delete(id: MapMasterId): F0[Unit]

trait MapMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]]
  def find(id: MapMasterId): F[Option[MapMaster]]
  def create(map: MapMaster): F[Unit]
  def createWithNextDisplayOrder(map: MapMaster): F[MapMaster]
  def update(map: MapMaster): F[Unit]
  def delete(id: MapMasterId): F[Unit]

object MapMastersRepository:
  def fromAlg[F0[_], F[_]](alg: MapMastersAlg[F0], liftK: F0 ~> F): MapMastersRepository[F] =
    new MapMastersRepository[F]:
      def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] = liftK(alg.list(gameTitleId))
      def find(id: MapMasterId): F[Option[MapMaster]] = liftK(alg.find(id))
      def create(map: MapMaster): F[Unit] = liftK(alg.create(map))
      def createWithNextDisplayOrder(map: MapMaster): F[MapMaster] =
        liftK(alg.createWithNextDisplayOrder(map))
      def update(map: MapMaster): F[Unit] = liftK(alg.update(map))
      def delete(id: MapMasterId): F[Unit] = liftK(alg.delete(id))

  def liftIdentity[F[_]](alg: MapMastersAlg[F]): MapMastersRepository[F] =
    new MapMastersRepository[F]:
      export alg.*
end MapMastersRepository

trait SeasonMastersAlg[F0[_]]:
  def list(gameTitleId: Option[GameTitleId]): F0[List[SeasonMaster]]
  def find(id: SeasonMasterId): F0[Option[SeasonMaster]]
  def create(season: SeasonMaster): F0[Unit]
  def createWithNextDisplayOrder(season: SeasonMaster): F0[SeasonMaster]
  def update(season: SeasonMaster): F0[Unit]
  def delete(id: SeasonMasterId): F0[Unit]

trait SeasonMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]]
  def find(id: SeasonMasterId): F[Option[SeasonMaster]]
  def create(season: SeasonMaster): F[Unit]
  def createWithNextDisplayOrder(season: SeasonMaster): F[SeasonMaster]
  def update(season: SeasonMaster): F[Unit]
  def delete(id: SeasonMasterId): F[Unit]

object SeasonMastersRepository:
  def fromAlg[F0[_], F[_]](alg: SeasonMastersAlg[F0], liftK: F0 ~> F): SeasonMastersRepository[F] =
    new SeasonMastersRepository[F]:
      def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] =
        liftK(alg.list(gameTitleId))
      def find(id: SeasonMasterId): F[Option[SeasonMaster]] = liftK(alg.find(id))
      def create(season: SeasonMaster): F[Unit] = liftK(alg.create(season))
      def createWithNextDisplayOrder(season: SeasonMaster): F[SeasonMaster] =
        liftK(alg.createWithNextDisplayOrder(season))
      def update(season: SeasonMaster): F[Unit] = liftK(alg.update(season))
      def delete(id: SeasonMasterId): F[Unit] = liftK(alg.delete(id))

  def liftIdentity[F[_]](alg: SeasonMastersAlg[F]): SeasonMastersRepository[F] =
    new SeasonMastersRepository[F]:
      export alg.*
end SeasonMastersRepository

trait IncidentMastersAlg[F0[_]]:
  def list: F0[List[IncidentMaster]]

trait IncidentMastersRepository[F[_]]:
  def list: F[List[IncidentMaster]]

object IncidentMastersRepository:
  def fromAlg[F0[_], F[_]](
      alg: IncidentMastersAlg[F0],
      liftK: F0 ~> F,
  ): IncidentMastersRepository[F] = new IncidentMastersRepository[F]:
    def list: F[List[IncidentMaster]] = liftK(alg.list)

  def liftIdentity[F[_]](alg: IncidentMastersAlg[F]): IncidentMastersRepository[F] =
    new IncidentMastersRepository[F]:
      export alg.*
end IncidentMastersRepository

trait MemberAliasesAlg[F0[_]]:
  def list(memberId: Option[MemberId]): F0[List[MemberAlias]]
  def find(id: MemberAliasId): F0[Option[MemberAlias]]
  def create(alias: MemberAlias): F0[Unit]
  def update(alias: MemberAlias): F0[Unit]
  def delete(id: MemberAliasId): F0[Unit]

trait MemberAliasesRepository[F[_]]:
  def list(memberId: Option[MemberId]): F[List[MemberAlias]]
  def find(id: MemberAliasId): F[Option[MemberAlias]]
  def create(alias: MemberAlias): F[Unit]
  def update(alias: MemberAlias): F[Unit]
  def delete(id: MemberAliasId): F[Unit]

trait MembersAlg[F0[_]]:
  def list: F0[List[momo.api.domain.Member]]
  def find(id: MemberId): F0[Option[momo.api.domain.Member]]
  def findByDiscordUserId(userId: UserId): F0[Option[momo.api.domain.Member]]

trait MembersRepository[F[_]]:
  def list: F[List[momo.api.domain.Member]]
  def find(id: MemberId): F[Option[momo.api.domain.Member]]
  def findByDiscordUserId(userId: UserId): F[Option[momo.api.domain.Member]]

object MembersRepository:
  def fromAlg[F0[_], F[_]](alg: MembersAlg[F0], liftK: F0 ~> F): MembersRepository[F] =
    new MembersRepository[F]:
      def list: F[List[momo.api.domain.Member]] = liftK(alg.list)
      def find(id: MemberId): F[Option[momo.api.domain.Member]] = liftK(alg.find(id))
      def findByDiscordUserId(userId: UserId): F[Option[momo.api.domain.Member]] =
        liftK(alg.findByDiscordUserId(userId))

  def liftIdentity[F[_]](alg: MembersAlg[F]): MembersRepository[F] = new MembersRepository[F]:
    export alg.*
end MembersRepository
