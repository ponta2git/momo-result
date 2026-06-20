package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  GameTitle, IncidentMaster, LoginAccount, MapMaster, Member, MemberAlias, SeasonMaster,
}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{
  AppSessionsRepository, CreateLoginAccountData, GameTitlesRepository, IncidentMastersRepository,
  LoginAccountAdministrationRepository, LoginAccountAdministrationUpdateResult,
  LoginAccountsRepository, MapMastersRepository, MemberAliasesRepository, MembersRepository,
  SeasonMastersRepository, UpdateLoginAccountData,
}

final class InMemoryGameTitlesRepository[F[_]: Sync] private (
    ref: Ref[F, Map[GameTitleId, GameTitle]],
    beforeDelete: GameTitleId => F[Unit],
) extends GameTitlesRepository[F]:
  override def list: F[List[GameTitle]] = ref.get
    .map(_.values.toList.sortBy(t => (t.displayOrder, t.createdAt, t.id.value)))
  override def find(id: GameTitleId): F[Option[GameTitle]] = ref.get.map(_.get(id))
  override def create(title: GameTitle): F[Unit] = ref.modify { items =>
    if containsGameTitleConflict(items, title, excluding = None) then
      (
        items,
        Left(masterConflict(s"game_title already exists: ${title.id.value} or ${title.name}")),
      )
    else (items.updated(title.id, title), Right(()))
  }.flatMap(completeUnit)
  override def createWithNextDisplayOrder(title: GameTitle): F[GameTitle] = ref.modify { items =>
    if containsGameTitleConflict(items, title, excluding = None) then
      (
        items,
        Left(masterConflict(s"game_title already exists: ${title.id.value} or ${title.name}")),
      )
    else
      val nextOrder = items.values.map(_.displayOrder).maxOption.getOrElse(0) + 1
      val created = title.copy(displayOrder = nextOrder)
      (items.updated(created.id, created), Right(created))
  }.flatMap(complete)
  override def update(title: GameTitle): F[Unit] = ref.modify { items =>
    if !items.contains(title.id) then (items, Left(notFound("game title", title.id.value)))
    else if containsGameTitleConflict(items, title, excluding = Some(title.id)) then
      (
        items,
        Left(masterConflict(s"game_title already exists: ${title.id.value} or ${title.name}")),
      )
    else (items.updated(title.id, title), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: GameTitleId): F[Unit] = ref.get.flatMap { items =>
    if !items.contains(id) then Sync[F].raiseError(notFound("game title", id.value))
    else
      beforeDelete(id) *> ref.modify { current =>
        if current.contains(id) then (current - id, Right(()))
        else (current, Left(notFound("game title", id.value)))
      }.flatMap(completeUnit)
  }

  private def containsGameTitleConflict(
      items: Map[GameTitleId, GameTitle],
      title: GameTitle,
      excluding: Option[GameTitleId],
  ): Boolean = items.values.exists(existing =>
    !excluding.contains(existing.id) && (existing.id == title.id || existing.name == title.name)
  )

object InMemoryGameTitlesRepository:
  def create[F[_]: Sync]: F[InMemoryGameTitlesRepository[F]] = Ref
    .of[F, Map[GameTitleId, GameTitle]](Map.empty)
    .map(new InMemoryGameTitlesRepository(_, _ => Sync[F].unit))

  def createWithDeleteGuard[F[_]: Sync](
      beforeDelete: GameTitleId => F[Unit]
  ): F[InMemoryGameTitlesRepository[F]] = Ref.of[F, Map[GameTitleId, GameTitle]](Map.empty)
    .map(new InMemoryGameTitlesRepository(_, beforeDelete))

final class InMemoryMapMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[MapMasterId, MapMaster]],
    beforeDelete: MapMasterId => F[Unit],
) extends MapMastersRepository[F]:
  override def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] = ref.get.map { m =>
    val items = gameTitleId match
      case Some(id) => m.values.filter(_.gameTitleId == id)
      case None => m.values
    items.toList.sortBy(x => (x.gameTitleId.value, x.displayOrder, x.createdAt, x.id.value))
  }
  override def find(id: MapMasterId): F[Option[MapMaster]] = ref.get.map(_.get(id))
  override def create(map: MapMaster): F[Unit] = ref.modify { items =>
    if containsMapConflict(items, map, excluding = None) then
      (items, Left(masterConflict(s"map_master already exists: ${map.id.value} or ${map.name}")))
    else (items.updated(map.id, map), Right(()))
  }.flatMap(completeUnit)
  override def createWithNextDisplayOrder(map: MapMaster): F[MapMaster] = ref.modify { items =>
    if containsMapConflict(items, map, excluding = None) then
      (items, Left(masterConflict(s"map_master already exists: ${map.id.value} or ${map.name}")))
    else
      val nextOrder = items.values.filter(_.gameTitleId == map.gameTitleId).map(_.displayOrder)
        .maxOption.getOrElse(0) + 1
      val created = map.copy(displayOrder = nextOrder)
      (items.updated(created.id, created), Right(created))
  }.flatMap(complete)
  override def update(map: MapMaster): F[Unit] = ref.modify { items =>
    if !items.contains(map.id) then (items, Left(notFound("map master", map.id.value)))
    else if containsMapConflict(items, map, excluding = Some(map.id)) then
      (items, Left(masterConflict(s"map_master already exists: ${map.id.value} or ${map.name}")))
    else (items.updated(map.id, map), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: MapMasterId): F[Unit] = ref.get.flatMap { items =>
    if !items.contains(id) then Sync[F].raiseError(notFound("map master", id.value))
    else
      beforeDelete(id) *> ref.modify { current =>
        if current.contains(id) then (current - id, Right(()))
        else (current, Left(notFound("map master", id.value)))
      }.flatMap(completeUnit)
  }

  private def containsMapConflict(
      items: Map[MapMasterId, MapMaster],
      map: MapMaster,
      excluding: Option[MapMasterId],
  ): Boolean = items.values.exists(existing =>
    !excluding.contains(existing.id) &&
      (existing.id == map.id ||
        (existing.gameTitleId == map.gameTitleId && existing.name == map.name))
  )

object InMemoryMapMastersRepository:
  def create[F[_]: Sync]: F[InMemoryMapMastersRepository[F]] = Ref
    .of[F, Map[MapMasterId, MapMaster]](Map.empty)
    .map(new InMemoryMapMastersRepository(_, _ => Sync[F].unit))

  def createWithDeleteGuard[F[_]: Sync](
      beforeDelete: MapMasterId => F[Unit]
  ): F[InMemoryMapMastersRepository[F]] = Ref.of[F, Map[MapMasterId, MapMaster]](Map.empty)
    .map(new InMemoryMapMastersRepository(_, beforeDelete))

final class InMemorySeasonMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[SeasonMasterId, SeasonMaster]],
    beforeDelete: SeasonMasterId => F[Unit],
) extends SeasonMastersRepository[F]:
  override def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] = ref.get.map { m =>
    val items = gameTitleId match
      case Some(id) => m.values.filter(_.gameTitleId == id)
      case None => m.values
    items.toList.sortBy(x => (x.gameTitleId.value, x.displayOrder, x.createdAt, x.id.value))
  }
  override def find(id: SeasonMasterId): F[Option[SeasonMaster]] = ref.get.map(_.get(id))
  override def create(season: SeasonMaster): F[Unit] = ref.modify { items =>
    if containsSeasonConflict(items, season, excluding = None) then
      (
        items,
        Left(masterConflict(s"season_master already exists: ${season.id.value} or ${season.name}")),
      )
    else (items.updated(season.id, season), Right(()))
  }.flatMap(completeUnit)
  override def createWithNextDisplayOrder(season: SeasonMaster): F[SeasonMaster] = ref
    .modify { items =>
      if containsSeasonConflict(items, season, excluding = None) then
        (
          items,
          Left(masterConflict(s"season_master already exists: ${season.id.value} or ${season
              .name}")),
        )
      else
        val nextOrder = items.values.filter(_.gameTitleId == season.gameTitleId).map(_.displayOrder)
          .maxOption.getOrElse(0) + 1
        val created = season.copy(displayOrder = nextOrder)
        (items.updated(created.id, created), Right(created))
    }.flatMap(complete)
  override def update(season: SeasonMaster): F[Unit] = ref.modify { items =>
    if !items.contains(season.id) then (items, Left(notFound("season master", season.id.value)))
    else if containsSeasonConflict(items, season, excluding = Some(season.id)) then
      (
        items,
        Left(masterConflict(s"season_master already exists: ${season.id.value} or ${season.name}")),
      )
    else (items.updated(season.id, season), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: SeasonMasterId): F[Unit] = ref.get.flatMap { items =>
    if !items.contains(id) then Sync[F].raiseError(notFound("season master", id.value))
    else
      beforeDelete(id) *> ref.modify { current =>
        if current.contains(id) then (current - id, Right(()))
        else (current, Left(notFound("season master", id.value)))
      }.flatMap(completeUnit)
  }

  private def containsSeasonConflict(
      items: Map[SeasonMasterId, SeasonMaster],
      season: SeasonMaster,
      excluding: Option[SeasonMasterId],
  ): Boolean = items.values.exists(existing =>
    !excluding.contains(existing.id) &&
      (existing.id == season.id ||
        (existing.gameTitleId == season.gameTitleId && existing.name == season.name))
  )

object InMemorySeasonMastersRepository:
  def create[F[_]: Sync]: F[InMemorySeasonMastersRepository[F]] = Ref
    .of[F, Map[SeasonMasterId, SeasonMaster]](Map.empty)
    .map(new InMemorySeasonMastersRepository(_, _ => Sync[F].unit))

  def createWithDeleteGuard[F[_]: Sync](
      beforeDelete: SeasonMasterId => F[Unit]
  ): F[InMemorySeasonMastersRepository[F]] = Ref.of[F, Map[SeasonMasterId, SeasonMaster]](Map.empty)
    .map(new InMemorySeasonMastersRepository(_, beforeDelete))

final class InMemoryIncidentMastersRepository[F[_]] private (ref: Ref[F, List[IncidentMaster]])
    extends IncidentMastersRepository[F]:
  override def list: F[List[IncidentMaster]] = ref.get

object InMemoryIncidentMastersRepository:
  /** Seeded with the 6 fixed incidents matching momo-db `0008` migration. */
  def create[F[_]: Sync]: F[InMemoryIncidentMastersRepository[F]] =
    val now = Instant.EPOCH
    val seed = List(
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_destination"),
        "destination",
        "目的地",
        1,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_plus_station"),
        "plus_station",
        "プラス駅",
        2,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_minus_station"),
        "minus_station",
        "マイナス駅",
        3,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_card_station"),
        "card_station",
        "カード駅",
        4,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_card_shop"),
        "card_shop",
        "カード売り場",
        5,
        now,
      ),
      IncidentMaster(
        IncidentMasterId.unsafeFromString("incident_suri_no_ginji"),
        "suri_no_ginji",
        "スリの銀次",
        6,
        now,
      ),
    )
    Ref.of[F, List[IncidentMaster]](seed).map(new InMemoryIncidentMastersRepository(_))

final class InMemoryMemberAliasesRepository[F[_]: Sync] private (ref: Ref[F, List[MemberAlias]])
    extends MemberAliasesRepository[F]:
  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] = ref.get.map { all =>
    memberId match
      case Some(id) => all.filter(_.memberId == id)
      case None => all
  }
  override def find(id: MemberAliasId): F[Option[MemberAlias]] = ref.get.map(_.find(_.id == id))
  override def create(alias: MemberAlias): F[Unit] = ref.modify { aliases =>
    if containsAliasConflict(aliases, alias, excluding = None) then
      (aliases, Left(masterConflict(s"member alias already exists: ${alias.alias}")))
    else (aliases :+ alias, Right(()))
  }.flatMap(completeUnit)
  override def update(alias: MemberAlias): F[Unit] = ref.modify { aliases =>
    if !aliases.exists(_.id == alias.id) then
      (aliases, Left(notFound("member alias", alias.id.value)))
    else if containsAliasConflict(aliases, alias, excluding = Some(alias.id)) then
      (aliases, Left(masterConflict(s"member alias already exists: ${alias.alias}")))
    else (aliases.map(existing => if existing.id == alias.id then alias else existing), Right(()))
  }.flatMap(completeUnit)
  override def delete(id: MemberAliasId): F[Unit] = ref.modify { aliases =>
    if aliases.exists(_.id == id) then (aliases.filterNot(_.id == id), Right(()))
    else (aliases, Left(notFound("member alias", id.value)))
  }.flatMap(completeUnit)

  private def containsAliasConflict(
      aliases: List[MemberAlias],
      alias: MemberAlias,
      excluding: Option[MemberAliasId],
  ): Boolean = aliases.exists(existing =>
    !excluding.contains(existing.id) &&
      (existing.id == alias.id ||
        (existing.memberId == alias.memberId && existing.alias == alias.alias))
  )

object InMemoryMemberAliasesRepository:
  def create[F[_]: Sync]: F[InMemoryMemberAliasesRepository[F]] = Ref.of[F, List[MemberAlias]](Nil)
    .map(new InMemoryMemberAliasesRepository(_))

final class InMemoryMembersRepository[F[_]: Sync] private (ref: Ref[F, Map[MemberId, Member]])
    extends MembersRepository[F]:
  override def list: F[List[Member]] = ref.get.map(_.values.toList.sortBy(_.id.value))
  override def find(id: MemberId): F[Option[Member]] = ref.get.map(_.get(id))
  override def findByDiscordUserId(userId: UserId): F[Option[Member]] = ref.get
    .map(_.values.find(_.userId == userId))

object InMemoryMembersRepository:
  def create[F[_]: Sync]: F[InMemoryMembersRepository[F]] = create(Nil)

  def create[F[_]: Sync](members: List[Member]): F[InMemoryMembersRepository[F]] = Ref
    .of[F, Map[MemberId, Member]](members.map(m => m.id -> m).toMap)
    .map(new InMemoryMembersRepository(_))

final class InMemoryLoginAccountsRepository[F[_]: Sync] private (
    ref: Ref[F, Map[AccountId, LoginAccount]]
) extends LoginAccountsRepository[F]:
  override def list: F[List[LoginAccount]] = ref.get
    .map(_.values.toList.sortBy(a => (!a.isAdmin, !a.loginEnabled, a.createdAt, a.id.value)))
  override def find(id: AccountId): F[Option[LoginAccount]] = ref.get.map(_.get(id))
  override def findByDiscordUserId(userId: UserId): F[Option[LoginAccount]] = ref.get
    .map(_.values.find(_.discordUserId == userId))
  override def create(account: CreateLoginAccountData): F[LoginAccount] =
    val created = LoginAccount(
      account.id,
      account.discordUserId,
      account.displayName,
      account.playerMemberId,
      account.loginEnabled,
      account.isAdmin,
      account.createdAt,
      account.updatedAt,
    )
    ref.modify { accounts =>
      if accounts.contains(created.id) ||
        accounts.values.exists(_.discordUserId == created.discordUserId)
      then
        (
          accounts,
          Left(masterConflict(s"login account already exists for discord user ${created
              .discordUserId.value}.")),
        )
      else (accounts.updated(created.id, created), Right(created))
    }.flatMap(complete)
  override def update(id: AccountId, data: UpdateLoginAccountData): F[Option[LoginAccount]] = ref
    .modify { accounts =>
      accounts.get(id) match
        case None => (accounts, None)
        case Some(existing) =>
          val updated = existing.copy(
            displayName = data.displayName.getOrElse(existing.displayName),
            playerMemberId = data.playerMemberId.getOrElse(existing.playerMemberId),
            loginEnabled = data.loginEnabled.getOrElse(existing.loginEnabled),
            isAdmin = data.isAdmin.getOrElse(existing.isAdmin),
            updatedAt = data.updatedAt,
          )
          val wouldRemoveLastAdmin = existing.loginEnabled && existing.isAdmin &&
            (!updated.loginEnabled || !updated.isAdmin) &&
            accounts.values.count(a => a.loginEnabled && a.isAdmin) <= 1
          if wouldRemoveLastAdmin then (accounts, None)
          else (accounts.updated(id, updated), Some(updated))
    }
  override def enabledAdminCount: F[Int] = ref.get
    .map(_.values.count(a => a.loginEnabled && a.isAdmin))

final class InMemoryLoginAccountAdministrationRepository[F[_]: Sync](
    accounts: LoginAccountsRepository[F],
    sessions: AppSessionsRepository[F],
) extends LoginAccountAdministrationRepository[F]:
  override def updateAndRevokeSessionsWhenDisabled(
      id: AccountId,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] =
    for
      existing <- accounts.find(id)
      result <- existing match
        case None => Sync[F].pure(LoginAccountAdministrationUpdateResult.NotFound)
        case Some(account) => updateExisting(account, data)
    yield result

  private def updateExisting(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  ): F[LoginAccountAdministrationUpdateResult] = accounts.update(existing.id, data).flatMap {
    case Some(updated) =>
      val revokeSessions = existing.loginEnabled && !updated.loginEnabled
      val revoke =
        if revokeSessions then sessions.deleteByAccount(existing.id).void else Sync[F].unit
      revoke.as(LoginAccountAdministrationUpdateResult.Updated(updated))
    case None if wouldRemoveEnabledAdmin(existing, data) =>
      Sync[F].pure(LoginAccountAdministrationUpdateResult.LastEnabledAdmin)
    case None => Sync[F].pure(LoginAccountAdministrationUpdateResult.NotFound)
  }

  private def wouldRemoveEnabledAdmin(
      existing: LoginAccount,
      data: UpdateLoginAccountData,
  ): Boolean =
    val nextLoginEnabled = data.loginEnabled.getOrElse(existing.loginEnabled)
    val nextIsAdmin = data.isAdmin.getOrElse(existing.isAdmin)
    existing.loginEnabled && existing.isAdmin && (!nextLoginEnabled || !nextIsAdmin)

object InMemoryLoginAccountsRepository:
  def create[F[_]: Sync](accounts: List[LoginAccount]): F[InMemoryLoginAccountsRepository[F]] = Ref
    .of[F, Map[AccountId, LoginAccount]](accounts.map(a => a.id -> a).toMap)
    .map(new InMemoryLoginAccountsRepository(_))

private def masterConflict(message: String): AppException =
  new AppException(AppError.Conflict(message))

private def notFound(resource: String, id: String): AppException =
  new AppException(AppError.NotFound(resource, id))

private def complete[F[_]: Sync, A](result: Either[AppException, A]): F[A] = result match
  case Right(value) => Sync[F].pure(value)
  case Left(error) => Sync[F].raiseError(error)

private def completeUnit[F[_]: Sync](result: Either[AppException, Unit]): F[Unit] = complete(result)
