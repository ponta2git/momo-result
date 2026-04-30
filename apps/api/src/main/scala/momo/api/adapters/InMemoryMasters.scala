package momo.api.adapters

import cats.effect.Ref
import cats.effect.Sync
import cats.syntax.functor.*
import momo.api.domain.GameTitle
import momo.api.domain.IncidentMaster
import momo.api.domain.MapMaster
import momo.api.domain.Member
import momo.api.domain.MemberAlias
import momo.api.domain.SeasonMaster
import momo.api.repositories.GameTitlesRepository
import momo.api.repositories.IncidentMastersRepository
import momo.api.repositories.MapMastersRepository
import momo.api.repositories.MemberAliasesRepository
import momo.api.repositories.MembersRepository
import momo.api.repositories.SeasonMastersRepository

import java.time.Instant

final class InMemoryGameTitlesRepository[F[_]: Sync] private (
    ref: Ref[F, Map[String, GameTitle]]
) extends GameTitlesRepository[F]:
  override def list: F[List[GameTitle]] =
    ref.get.map(_.values.toList.sortBy(t => (t.displayOrder, t.createdAt, t.id)))
  override def find(id: String): F[Option[GameTitle]] = ref.get.map(_.get(id))
  override def create(title: GameTitle): F[Unit] = ref.update(_ + (title.id -> title))

object InMemoryGameTitlesRepository:
  def create[F[_]: Sync]: F[InMemoryGameTitlesRepository[F]] =
    Ref.of[F, Map[String, GameTitle]](Map.empty).map(new InMemoryGameTitlesRepository(_))

final class InMemoryMapMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[String, MapMaster]]
) extends MapMastersRepository[F]:
  override def list(gameTitleId: Option[String]): F[List[MapMaster]] =
    ref.get.map { m =>
      val items = gameTitleId match
        case Some(id) => m.values.filter(_.gameTitleId == id)
        case None     => m.values
      items.toList.sortBy(x => (x.gameTitleId, x.displayOrder, x.createdAt, x.id))
    }
  override def find(id: String): F[Option[MapMaster]] = ref.get.map(_.get(id))
  override def create(map: MapMaster): F[Unit] = ref.update(_ + (map.id -> map))
  override def nextDisplayOrder(gameTitleId: String): F[Int] =
    ref.get.map { m =>
      val maxOrder = m.values.filter(_.gameTitleId == gameTitleId).map(_.displayOrder).maxOption.getOrElse(0)
      maxOrder + 1
    }

object InMemoryMapMastersRepository:
  def create[F[_]: Sync]: F[InMemoryMapMastersRepository[F]] =
    Ref.of[F, Map[String, MapMaster]](Map.empty).map(new InMemoryMapMastersRepository(_))

final class InMemorySeasonMastersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[String, SeasonMaster]]
) extends SeasonMastersRepository[F]:
  override def list(gameTitleId: Option[String]): F[List[SeasonMaster]] =
    ref.get.map { m =>
      val items = gameTitleId match
        case Some(id) => m.values.filter(_.gameTitleId == id)
        case None     => m.values
      items.toList.sortBy(x => (x.gameTitleId, x.displayOrder, x.createdAt, x.id))
    }
  override def find(id: String): F[Option[SeasonMaster]] = ref.get.map(_.get(id))
  override def create(season: SeasonMaster): F[Unit] = ref.update(_ + (season.id -> season))
  override def nextDisplayOrder(gameTitleId: String): F[Int] =
    ref.get.map { m =>
      val maxOrder = m.values.filter(_.gameTitleId == gameTitleId).map(_.displayOrder).maxOption.getOrElse(0)
      maxOrder + 1
    }

object InMemorySeasonMastersRepository:
  def create[F[_]: Sync]: F[InMemorySeasonMastersRepository[F]] =
    Ref.of[F, Map[String, SeasonMaster]](Map.empty).map(new InMemorySeasonMastersRepository(_))

final class InMemoryIncidentMastersRepository[F[_]: Sync] private (
    ref: Ref[F, List[IncidentMaster]]
) extends IncidentMastersRepository[F]:
  override def list: F[List[IncidentMaster]] = ref.get

object InMemoryIncidentMastersRepository:
  /** Seeded with the 6 fixed incidents matching momo-db `0008` migration. */
  def create[F[_]: Sync]: F[InMemoryIncidentMastersRepository[F]] =
    val now = Instant.EPOCH
    val seed = List(
      IncidentMaster("incident_destination", "destination", "目的地", 1, now),
      IncidentMaster("incident_plus_station", "plus_station", "プラス駅", 2, now),
      IncidentMaster("incident_minus_station", "minus_station", "マイナス駅", 3, now),
      IncidentMaster("incident_card_station", "card_station", "カード駅", 4, now),
      IncidentMaster("incident_card_shop", "card_shop", "カード売り場", 5, now),
      IncidentMaster("incident_suri_no_ginji", "suri_no_ginji", "スリの銀次", 6, now)
    )
    Ref.of[F, List[IncidentMaster]](seed).map(new InMemoryIncidentMastersRepository(_))

final class InMemoryMemberAliasesRepository[F[_]: Sync] private (
    ref: Ref[F, List[MemberAlias]]
) extends MemberAliasesRepository[F]:
  override def list(memberId: Option[String]): F[List[MemberAlias]] =
    ref.get.map { all =>
      memberId match
        case Some(id) => all.filter(_.memberId == id)
        case None     => all
    }
  override def create(alias: MemberAlias): F[Unit] = ref.update(_ :+ alias)

object InMemoryMemberAliasesRepository:
  def create[F[_]: Sync]: F[InMemoryMemberAliasesRepository[F]] =
    Ref.of[F, List[MemberAlias]](Nil).map(new InMemoryMemberAliasesRepository(_))

final class InMemoryMembersRepository[F[_]: Sync] private (
    ref: Ref[F, Map[String, Member]]
) extends MembersRepository[F]:
  override def list: F[List[Member]] =
    ref.get.map(_.values.toList.sortBy(_.id))
  override def find(id: String): F[Option[Member]] = ref.get.map(_.get(id))

object InMemoryMembersRepository:
  def create[F[_]: Sync](members: List[Member] = Nil): F[InMemoryMembersRepository[F]] =
    Ref.of[F, Map[String, Member]](members.map(m => m.id -> m).toMap)
      .map(new InMemoryMembersRepository(_))
