package momo.api.bootstrap

import java.time.Instant

import cats.Monad

import momo.api.domain.ids.MemberAliasId
import momo.api.http.modules.{MasterMemberAliasRoutes, MasterModule}
import momo.api.repositories.*
import momo.api.usecases.masters.*

private[bootstrap] object MasterUseCaseWiring:
  def apply[F[_]: Monad](
      gameTitles: GameTitlesRepository[F],
      maps: MapMastersRepository[F],
      seasons: SeasonMastersRepository[F],
      incidents: IncidentMastersRepository[F],
      aliases: MemberAliasesRepository[F],
      members: MembersRepository[F],
      now: F[Instant],
      nextAliasId: F[MemberAliasId],
  ): MasterModule.UseCases[F] = MasterModule.UseCases(
    listGameTitles = ListGameTitles[F](gameTitles),
    listMapMasters = ListMapMasters[F](maps),
    listSeasonMasters = ListSeasonMasters[F](seasons),
    listIncidentMasters = ListIncidentMasters[F](incidents),
    createGameTitle = CreateGameTitle[F](gameTitles, now),
    createMapMaster = CreateMapMaster[F](gameTitles, maps, now),
    createSeasonMaster = CreateSeasonMaster[F](gameTitles, seasons, now),
    updateGameTitle = UpdateGameTitle[F](gameTitles),
    updateMapMaster = UpdateMapMaster[F](maps),
    updateSeasonMaster = UpdateSeasonMaster[F](seasons),
    deleteGameTitle = DeleteGameTitle[F](gameTitles),
    deleteMapMaster = DeleteMapMaster[F](maps),
    deleteSeasonMaster = DeleteSeasonMaster[F](seasons),
    aliases = MasterMemberAliasRoutes.UseCases(
      listMemberAliases = ListMemberAliases[F](aliases),
      createMemberAlias = CreateMemberAlias[F](aliases, members, now, nextAliasId),
      updateMemberAlias = UpdateMemberAlias[F](aliases, members),
      deleteMemberAlias = DeleteMemberAlias[F](aliases),
    ),
  )
