package momo.api.http.modules

import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.MatchId
import momo.api.endpoints.codec.{MatchCodec, MatchListCodec}
import momo.api.endpoints.{
  ConfirmMatchRequest, ConfirmMatchResponse, DeleteMatchResponse, MatchDetailResponse,
  MatchListResponse, MatchSummaryResponse, MatchesEndpoints, UpdateMatchRequest,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
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
    MatchesEndpoints.confirm.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, ConfirmMatchRequest, ConfirmMatchResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/matches",
          request,
          nowF,
          security.respond(
            confirmMatch
              .run(MatchCodec.toConfirmCommand(request), member.accountId, member.playerMemberId)
          )(record =>
            ConfirmMatchResponse(
              matchId = record.id.value,
              heldEventId = record.heldEventId.value,
              matchNoInEvent = record.matchNoInEvent.value,
              createdAt = DateTimeFormatter.ISO_INSTANT.format(record.createdAt),
            )
          ),
        )
      }
    },
    MatchesEndpoints.list.serverLogic {
      case (heldEventId, gameTitleId, seasonMasterId, status, kind, limit, accountHeader) =>
        security.authorizeRead(accountHeader) { _ =>
          security.respond(listMatches.run(
            MatchListCodec
              .toListCommand(heldEventId, gameTitleId, seasonMasterId, status, kind, limit)
          ))(items => MatchListResponse(items.map(MatchSummaryResponse.from)))
        }
    },
    MatchesEndpoints.get.serverLogic { case (matchId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        security.respond(getMatch.run(MatchId.unsafeFromString(matchId)))(MatchDetailResponse.from)
      }
    },
    MatchesEndpoints.update.serverLogic {
      case (matchId, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, UpdateMatchRequest, MatchDetailResponse](
              idempotency,
              idemKey,
              member,
              s"PUT /api/matches/$matchId",
              request,
              nowF,
              security.respond(
                updateMatch
                  .run(MatchId.unsafeFromString(matchId), MatchCodec.toUpdateCommand(request))
              )(MatchDetailResponse.from),
            )
          }
    },
    MatchesEndpoints.delete.serverLogic { case (matchId, accountHeader, csrfToken, idemKey) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, DeleteMatchResponse](
          idempotency,
          idemKey,
          member,
          s"DELETE /api/matches/$matchId",
          matchId,
          nowF,
          security.respond(
            deleteMatch.run(MatchId.unsafeFromString(matchId))
          )(_ => DeleteMatchResponse(matchId, deleted = true)),
        )
      }
    },
  )
