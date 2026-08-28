package momo.api.repositories

import cats.{~>, MonadThrow}

import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, IncidentMaster, MapMaster, MemberAlias, SeasonMaster}
import momo.api.errors.AppError

trait GameTitlesAlg[F0[_]]:
  def list: F0[List[GameTitle]]
  def find(id: GameTitleId): F0[Option[GameTitle]]
  def createWithNextDisplayOrder(title: GameTitle): F0[GameTitle]
  def update(title: GameTitle): F0[Unit]
  def delete(id: GameTitleId): F0[Unit]

/** Usecase-facing facade: expected command rejections are values; unexpected failures remain in F. */
trait GameTitlesRepository[F[_]]:
  def list: F[List[GameTitle]]
  def find(id: GameTitleId): F[Option[GameTitle]]
  def createWithNextDisplayOrder(title: GameTitle): F[Either[AppError, GameTitle]]
  def update(title: GameTitle): F[Either[AppError, Unit]]
  def delete(id: GameTitleId): F[Either[AppError, Unit]]

object GameTitlesRepository:
  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: GameTitlesAlg[F0],
      liftK: F0 ~> F,
  ): GameTitlesRepository[F] =
    new GameTitlesRepository[F]:
      def list: F[List[GameTitle]] = liftK(alg.list)
      def find(id: GameTitleId): F[Option[GameTitle]] = liftK(alg.find(id))
      def createWithNextDisplayOrder(title: GameTitle): F[Either[AppError, GameTitle]] =
        RepositoryResult.capture(liftK(alg.createWithNextDisplayOrder(title)))
      def update(title: GameTitle): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.update(title)))
      def delete(id: GameTitleId): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.delete(id)))
end GameTitlesRepository

trait MapMastersAlg[F0[_]]:
  def list(gameTitleId: Option[GameTitleId]): F0[List[MapMaster]]
  def find(id: MapMasterId): F0[Option[MapMaster]]
  def createWithNextDisplayOrder(map: MapMaster): F0[MapMaster]
  def update(map: MapMaster): F0[Unit]
  def delete(id: MapMasterId): F0[Unit]

/** Usecase-facing facade: expected command rejections are values; unexpected failures remain in F. */
trait MapMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]]
  def find(id: MapMasterId): F[Option[MapMaster]]
  def createWithNextDisplayOrder(map: MapMaster): F[Either[AppError, MapMaster]]
  def update(map: MapMaster): F[Either[AppError, Unit]]
  def delete(id: MapMasterId): F[Either[AppError, Unit]]

object MapMastersRepository:
  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: MapMastersAlg[F0],
      liftK: F0 ~> F,
  ): MapMastersRepository[F] =
    new MapMastersRepository[F]:
      def list(gameTitleId: Option[GameTitleId]): F[List[MapMaster]] = liftK(alg.list(gameTitleId))
      def find(id: MapMasterId): F[Option[MapMaster]] = liftK(alg.find(id))
      def createWithNextDisplayOrder(map: MapMaster): F[Either[AppError, MapMaster]] =
        RepositoryResult.capture(liftK(alg.createWithNextDisplayOrder(map)))
      def update(map: MapMaster): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.update(map)))
      def delete(id: MapMasterId): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.delete(id)))
end MapMastersRepository

trait SeasonMastersAlg[F0[_]]:
  def list(gameTitleId: Option[GameTitleId]): F0[List[SeasonMaster]]
  def find(id: SeasonMasterId): F0[Option[SeasonMaster]]
  def createWithNextDisplayOrder(season: SeasonMaster): F0[SeasonMaster]
  def update(season: SeasonMaster): F0[Unit]
  def delete(id: SeasonMasterId): F0[Unit]

/** Usecase-facing facade: expected command rejections are values; unexpected failures remain in F. */
trait SeasonMastersRepository[F[_]]:
  def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]]
  def find(id: SeasonMasterId): F[Option[SeasonMaster]]
  def createWithNextDisplayOrder(season: SeasonMaster): F[Either[AppError, SeasonMaster]]
  def update(season: SeasonMaster): F[Either[AppError, Unit]]
  def delete(id: SeasonMasterId): F[Either[AppError, Unit]]

object SeasonMastersRepository:
  def fromAlg[F0[_], F[_]: MonadThrow](
      alg: SeasonMastersAlg[F0],
      liftK: F0 ~> F,
  ): SeasonMastersRepository[F] =
    new SeasonMastersRepository[F]:
      def list(gameTitleId: Option[GameTitleId]): F[List[SeasonMaster]] =
        liftK(alg.list(gameTitleId))
      def find(id: SeasonMasterId): F[Option[SeasonMaster]] = liftK(alg.find(id))
      def createWithNextDisplayOrder(
          season: SeasonMaster
      ): F[Either[AppError, SeasonMaster]] = RepositoryResult
        .capture(liftK(alg.createWithNextDisplayOrder(season)))
      def update(season: SeasonMaster): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.update(season)))
      def delete(id: SeasonMasterId): F[Either[AppError, Unit]] = RepositoryResult
        .capture(liftK(alg.delete(id)))
end SeasonMastersRepository

trait IncidentMastersAlg[F0[_]]:
  def list: F0[List[IncidentMaster]]

trait IncidentMastersRepository[F[_]] extends IncidentMastersAlg[F]

object IncidentMastersRepository:
  def fromAlg[F0[_], F[_]](
      alg: IncidentMastersAlg[F0],
      liftK: F0 ~> F,
  ): IncidentMastersRepository[F] = new IncidentMastersRepository[F]:
    def list: F[List[IncidentMaster]] = liftK(alg.list)
end IncidentMastersRepository

trait MemberAliasesAlg[F0[_]]:
  def list(memberId: Option[MemberId]): F0[List[MemberAlias]]
  def find(id: MemberAliasId): F0[Option[MemberAlias]]
  def create(alias: MemberAlias): F0[Unit]
  def update(alias: MemberAlias): F0[Unit]
  def delete(id: MemberAliasId): F0[Unit]

/** Usecase-facing port: expected command rejections are values; unexpected failures remain in F. */
trait MemberAliasesRepository[F[_]]:
  def list(memberId: Option[MemberId]): F[List[MemberAlias]]
  def find(id: MemberAliasId): F[Option[MemberAlias]]
  def create(alias: MemberAlias): F[Either[AppError, Unit]]
  def update(alias: MemberAlias): F[Either[AppError, Unit]]
  def delete(id: MemberAliasId): F[Either[AppError, Unit]]

trait MembersAlg[F0[_]]:
  def list: F0[List[momo.api.domain.Member]]
  def find(id: MemberId): F0[Option[momo.api.domain.Member]]

trait MembersRepository[F[_]] extends MembersAlg[F]

object MembersRepository:
  def fromAlg[F0[_], F[_]](alg: MembersAlg[F0], liftK: F0 ~> F): MembersRepository[F] =
    new MembersRepository[F]:
      def list: F[List[momo.api.domain.Member]] = liftK(alg.list)
      def find(id: MemberId): F[Option[momo.api.domain.Member]] = liftK(alg.find(id))
end MembersRepository
