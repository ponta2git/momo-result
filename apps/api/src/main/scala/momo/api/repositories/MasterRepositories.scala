package momo.api.repositories

import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}

trait GameTitlesRepository[F[_]]:
  def list: F[List[GameTitle]]
  def find(id: String): F[Option[GameTitle]]
  def create(title: GameTitle): F[Unit]

trait MapMastersRepository[F[_]]:
  def list(gameTitleId: Option[String]): F[List[MapMaster]]
  def find(id: String): F[Option[MapMaster]]
  def create(map: MapMaster): F[Unit]
  def nextDisplayOrder(gameTitleId: String): F[Int]

trait SeasonMastersRepository[F[_]]:
  def list(gameTitleId: Option[String]): F[List[SeasonMaster]]
  def find(id: String): F[Option[SeasonMaster]]
  def create(season: SeasonMaster): F[Unit]
  def nextDisplayOrder(gameTitleId: String): F[Int]

trait IncidentMastersRepository[F[_]]:
  def list: F[List[IncidentMaster]]

trait MemberAliasesRepository[F[_]]:
  def list(memberId: Option[String]): F[List[MemberAlias]]
  def create(alias: MemberAlias): F[Unit]

trait MembersRepository[F[_]]:
  def list: F[List[momo.api.domain.Member]]
  def find(id: String): F[Option[momo.api.domain.Member]]
