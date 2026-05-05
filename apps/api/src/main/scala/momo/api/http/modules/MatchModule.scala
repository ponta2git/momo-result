package momo.api.http.modules

import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.MatchId
import momo.api.endpoints.codec.{MatchCodec, MatchListCodec}
import momo.api.endpoints.{
  ConfirmMatchRequest, ConfirmMatchResponse, DeleteMatchResponse, MatchDetailResponse,
  MatchListResponse, MatchSummaryResponse, MatchesEndpoints,
}
import momo.api.http.{EndpointSecurity, IdempotencyHandler}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{ConfirmMatch, DeleteMatch, GetMatch, ListMatches, UpdateMatch}

object MatchModule:
  def routes[F[_]: Async](
      confirmMatch: ConfirmMatch[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      deleteMatch: DeleteMatch[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    MatchesEndpoints.confirm.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, ConfirmMatchRequest, ConfirmMatchResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/matches",
          request,
          nowF,
          security.respond(
            confirmMatch.run(MatchCodec.toConfirmCommand(request), member.memberId)
          )(record =>
            ConfirmMatchResponse(
              matchId = record.id.value,
              heldEventId = record.heldEventId.value,
              matchNoInEvent = record.matchNoInEvent,
              createdAt = DateTimeFormatter.ISO_INSTANT.format(record.createdAt),
            )
          ),
        )
      }
    },
    MatchesEndpoints.list.serverLogic {
      case (heldEventId, gameTitleId, seasonMasterId, status, kind, limit, devUser) =>
        security.authorizeRead(devUser) { _ =>
          security.respond(listMatches.run(MatchListCodec.toListCommand(
            heldEventId,
            gameTitleId,
            seasonMasterId,
            status,
            kind,
            limit,
          )))(items => MatchListResponse(items.map(MatchSummaryResponse.from)))
        }
    },
    MatchesEndpoints.get.serverLogic { case (matchId, devUser) =>
      security.authorizeRead(devUser) { _ =>
        security.respond(getMatch.run(MatchId(matchId)))(MatchDetailResponse.from)
      }
    },
    MatchesEndpoints.update.serverLogic { case (matchId, devUser, csrfToken, request) =>
      security.authorizeMutation(devUser, csrfToken) { _ =>
        security.respond(
          updateMatch.run(MatchId(matchId), MatchCodec.toUpdateCommand(request))
        )(MatchDetailResponse.from)
      }
    },
    MatchesEndpoints.delete.serverLogic { case (matchId, devUser, csrfToken) =>
      security.authorizeMutation(devUser, csrfToken) { _ =>
        security.respond(deleteMatch.run(MatchId(matchId)))(_ =>
          DeleteMatchResponse(matchId, deleted = true)
        )
      }
    },
  )
