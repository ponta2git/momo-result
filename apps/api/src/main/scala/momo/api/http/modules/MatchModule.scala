package momo.api.http.modules

import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.MatchId
import momo.api.endpoints.codec.{BoundaryId, MatchCodec, MatchListCodec}
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
          security.decode(MatchCodec.toConfirmCommand(request))(command =>
            security
              .respond(confirmMatch.run(command, member.accountId, member.playerMemberId))(record =>
                ConfirmMatchResponse(
                  matchId = record.id.value,
                  heldEventId = record.heldEventId.value,
                  matchNoInEvent = record.matchNoInEvent.value,
                  createdAt = DateTimeFormatter.ISO_INSTANT.format(record.createdAt),
                )
              )
          ),
        )
      }
    },
    MatchesEndpoints.list.serverLogic {
      case (heldEventId, gameTitleId, seasonMasterId, status, kind, limit, accountHeader) =>
        security.authorizeRead(accountHeader) { _ =>
          security.decode(
            MatchListCodec
              .toListCommand(heldEventId, gameTitleId, seasonMasterId, status, kind, limit)
          )(command =>
            security.respond(
              listMatches.run(command)
            )(items => MatchListResponse(items.map(MatchSummaryResponse.from)))
          )
        }
    },
    MatchesEndpoints.get.serverLogic { case (matchId, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        security.decode(
          BoundaryId.required("matchId", matchId)(MatchId.fromString)
        )(id => security.respond(getMatch.run(id))(MatchDetailResponse.from))
      }
    },
    MatchesEndpoints.update.serverLogic {
      case (matchId, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, (String, UpdateMatchRequest), MatchDetailResponse](
              idempotency,
              idemKey,
              member,
              "PUT /api/matches/:id",
              (matchId, request),
              nowF,
              security.decode(BoundaryId.required("matchId", matchId)(MatchId.fromString)) { id =>
                security.decode(MatchCodec.toUpdateCommand(request))(command =>
                  security.respond(updateMatch.run(id, command))(MatchDetailResponse.from)
                )
              },
            )
          }
    },
    MatchesEndpoints.delete.serverLogic { case (matchId, accountHeader, csrfToken, idemKey) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, DeleteMatchResponse](
          idempotency,
          idemKey,
          member,
          "DELETE /api/matches/:id",
          matchId,
          nowF,
          security.decode(BoundaryId.required("matchId", matchId)(MatchId.fromString))(id =>
            security.respond(deleteMatch.run(id))(_ => DeleteMatchResponse(matchId, deleted = true))
          ),
        )
      }
    },
  )
