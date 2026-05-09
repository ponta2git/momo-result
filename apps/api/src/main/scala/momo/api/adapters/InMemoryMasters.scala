package momo.api.adapters

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.domain.ids.*
import momo.api.domain.{
  GameTitle, IncidentMaster, LoginAccount, MapMaster, Member, MemberAlias, SeasonMaster,
}
import momo.api.repositories.{
  CreateLoginAccountData, GameTitlesRepository, IncidentMastersRepository, LoginAccountsRepository,
  MapMastersRepository, MemberAliasesRepository, MembersRepository, SeasonMastersRepository,
  UpdateLoginAccountData,
}

final class InMemoryGameTitlesRepository[F[_]: Sync] private (
    ref: Ref[F, Map[GameTitleId, GameTitle]]
) extends GameTitlesRepository[F]:
  override def list: F[List[GameTitle]] = ref.get
    .map(_.values.toList.sortBy(t => (t.displayOrder, t.createdAt, t.id.value)))
  override def find(id: GameTitleId): F[Option[GameTitle]] = ref.get.map(_.get(id))
  override def create(title: GameTitle): F[Unit] = ref.update(_ + (title.id -> title))
  override def nextDisplayOrder: F[Int] = ref.get
    .map(_.values.map(_.displayOrder).maxOption.getOrElse(0) + 1)

object InMemoryGameTitlesRepository:
  def create[F[_]: Sync]: F[InMemoryGameTitlesRepository[F]] = Ref
    .of[F, Map[GameTitleId, GameTitle]](Map.empty).map(new InMemoryGameTitlesRepository(_))

final class InMemoryMapMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[MapMasterId, MapMaster]]
) extends MapMastersRepository[F]:
  override def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] = ref.get.map { m =>
    val items = gameTitleId match
      case Some(id) => m.values.filter(_.gameTitleId == id)
      case None => m.values
    items.toList.sortBy(x => (x.gameTitleId.value, x.displayOrder, x.createdAt, x.id.value))
  }
  override def find(id: MapMasterId): F[Option[MapMaster]] = ref.get.map(_.get(id))
  override def create(map: MapMaster): F[Unit] = ref.update(_ + (map.id -> map))
  override def nextDisplayOrder(gameTitleId: GameTitleId): F[Int] = ref.get.map { m =>
    val maxOrder = m.values.filter(_.gameTitleId == gameTitleId).map(_.displayOrder).maxOption
      .getOrElse(0)
    maxOrder + 1
  }

object InMemoryMapMastersRepository:
  def create[F[_]: Sync]: F[InMemoryMapMastersRepository[F]] = Ref
    .of[F, Map[MapMasterId, MapMaster]](Map.empty).map(new InMemoryMapMastersRepository(_))

final class InMemorySeasonMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[SeasonMasterId, SeasonMaster]]
) extends SeasonMastersRepository[F]:
  override def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] = ref.get.map { m =>
    val items = gameTitleId match
      case Some(id) => m.values.filter(_.gameTitleId == id)
      case None => m.values
    items.toList.sortBy(x => (x.gameTitleId.value, x.displayOrder, x.createdAt, x.id.value))
  }
  override def find(id: SeasonMasterId): F[Option[SeasonMaster]] = ref.get.map(_.get(id))
  override def create(season: SeasonMaster): F[Unit] = ref.update(_ + (season.id -> season))
  override def nextDisplayOrder(gameTitleId: GameTitleId): F[Int] = ref.get.map { m =>
    val maxOrder = m.values.filter(_.gameTitleId == gameTitleId).map(_.displayOrder).maxOption
      .getOrElse(0)
    maxOrder + 1
  }

object InMemorySeasonMastersRepository:
  def create[F[_]: Sync]: F[InMemorySeasonMastersRepository[F]] = Ref
    .of[F, Map[SeasonMasterId, SeasonMaster]](Map.empty).map(new InMemorySeasonMastersRepository(_))

final class InMemoryIncidentMastersRepository[F[_]] private (ref: Ref[F, List[IncidentMaster]])
    extends IncidentMastersRepository[F]:
  override def list: F[List[IncidentMaster]] = ref.get

object InMemoryIncidentMastersRepository:
  /** Seeded with the 6 fixed incidents matching momo-db `0008` migration. */
  def create[F[_]: Sync]: F[InMemoryIncidentMastersRepository[F]] =
    val now = Instant.EPOCH
    val seed = List(
      IncidentMaster(IncidentMasterId("incident_destination"), "destination", "目的地", 1, now),
      IncidentMaster(IncidentMasterId("incident_plus_station"), "plus_station", "プラス駅", 2, now),
      IncidentMaster(IncidentMasterId("incident_minus_station"), "minus_station", "マイナス駅", 3, now),
      IncidentMaster(IncidentMasterId("incident_card_station"), "card_station", "カード駅", 4, now),
      IncidentMaster(IncidentMasterId("incident_card_shop"), "card_shop", "カード売り場", 5, now),
      IncidentMaster(IncidentMasterId("incident_suri_no_ginji"), "suri_no_ginji", "スリの銀次", 6, now),
    )
    Ref.of[F, List[IncidentMaster]](seed).map(new InMemoryIncidentMastersRepository(_))

final class InMemoryMemberAliasesRepository[F[_]: Sync] private (ref: Ref[F, List[MemberAlias]])
    extends MemberAliasesRepository[F]:
  override def list(memberId: Option[MemberId]): F[List[MemberAlias]] = ref.get.map { all =>
    memberId match
      case Some(id) => all.filter(_.memberId == id)
      case None => all
  }
  override def create(alias: MemberAlias): F[Unit] = ref.update(_ :+ alias)

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
    ref.update(_ + (created.id -> created)).as(created)
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
          (accounts.updated(id, updated), Some(updated))
    }
  override def enabledAdminCount: F[Int] = ref.get
    .map(_.values.count(a => a.loginEnabled && a.isAdmin))

object InMemoryLoginAccountsRepository:
  def create[F[_]: Sync](accounts: List[LoginAccount]): F[InMemoryLoginAccountsRepository[F]] = Ref
    .of[F, Map[AccountId, LoginAccount]](accounts.map(a => a.id -> a).toMap)
    .map(new InMemoryLoginAccountsRepository(_))
