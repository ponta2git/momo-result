package momo.api.http.modules

import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{GameTitleId, MatchId}
import momo.api.endpoints.*
import momo.api.endpoints.codec.{AchievementCodec, BoundaryId}
import momo.api.http.{HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.achievements.ManageAchievements

object AchievementsModule:
  def routes[F[_]](useCase: ManageAchievements[F], context: HttpRouteContext[F])
      : List[ServerEndpoint[Any, F]] =
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.readLogic(security, AchievementsEndpoints.catalog) { _ => title =>
        execution.execute(BoundaryId.required("gameTitleId", title)(GameTitleId.fromString))(
          useCase.catalog
        )(AchievementCatalogResponse.from)
      },
      SecuredEndpoint.operatorMutationLogic(security, AchievementsEndpoints.create) { actor =>
        { case (key, request) =>
          execution.mutation("POST /api/achievements/items", key, actor, request)(
            AchievementCodec.create(request)
          )(useCase.create(_, actor.accountId))(AchievementItemResponse.from)
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, AchievementsEndpoints.update) { actor =>
        { case (id, key, request) =>
          execution.mutation("PUT /api/achievements/items/:id", key, actor, (id, request))(
            (AchievementCodec.id(id), AchievementCodec.update(request)).tupled
          ) { case (parsed, command) => useCase.update(parsed, command, actor.accountId) }(
            AchievementItemResponse.from
          )
        }
      },
      SecuredEndpoint.operatorMutationLogic(security, AchievementsEndpoints.retire) { actor =>
        { case (id, key, request) =>
          execution.mutation("POST /api/achievements/items/:id/retire", key, actor, (id, request))(
            (AchievementCodec.id(id), AchievementCodec.version(request.expectedVersion)).tupled
          ) { case (parsed, version) => useCase.retire(parsed, version, actor.accountId) }(
            AchievementItemResponse.from
          )
        }
      },
      SecuredEndpoint.mutationLogic(security, AchievementsEndpoints.correctClaim) { actor =>
        { case (id, key, request) =>
          execution.mutation("PUT /api/achievements/claims/:id", key, actor, (id, request))(
            (AchievementCodec.id(id), AchievementCodec.correct(request)).tupled
          ) { case (parsed, command) => useCase.correctClaim(parsed, command, actor.accountId) }(
            AchievementClaimResponse.from
          )
        }
      },
      SecuredEndpoint.mutationLogic(security, AchievementsEndpoints.addToMatch) { actor =>
        { case (id, key, request) =>
          execution.mutation("POST /api/matches/:id/achievements", key, actor, (id, request))(
            (
              BoundaryId.required("matchId", id)(MatchId.fromString),
              AchievementCodec.addToMatch(request)
            ).tupled
          ) { case (parsed, command) => useCase.addToMatch(parsed, command, actor.accountId) }(_ =>
            AchievementSavedResponse(true)
          )
        }
      },
    )
