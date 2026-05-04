package momo.api.repositories

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}

trait GameTitlesRepository[F[_]]:
  def list: F[List[GameTitle]]
  def find(id: GameTitleId): F[Option[GameTitle]]
  def create(title: GameTitle): F[Unit]
  def nextDisplayOrder: F[Int]

trait MapMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]]
  def find(id: MapMasterId): F[Option[MapMaster]]
  def create(map: MapMaster): F[Unit]
  def nextDisplayOrder(gameTitleId: GameTitleId): F[Int]

trait SeasonMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]]
  def find(id: SeasonMasterId): F[Option[SeasonMaster]]
  def create(season: SeasonMaster): F[Unit]
  def nextDisplayOrder(gameTitleId: GameTitleId): F[Int]

trait IncidentMastersRepository[F[_]]:
  def list: F[List[IncidentMaster]]

trait MemberAliasesRepository[F[_]]:
  def list(memberId: Option[MemberId]): F[List[MemberAlias]]
  def create(alias: MemberAlias): F[Unit]

trait MembersRepository[F[_]]:
  def list: F[List[momo.api.domain.Member]]
  def find(id: MemberId): F[Option[momo.api.domain.Member]]
  def findByDiscordUserId(userId: UserId): F[Option[momo.api.domain.Member]]
