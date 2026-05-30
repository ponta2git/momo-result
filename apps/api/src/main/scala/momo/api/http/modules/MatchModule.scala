package momo.api.http.modules

import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.ids.MatchId
import momo.api.endpoints.codec.{BoundaryId, MatchCodec, MatchListCodec}
import momo.api.endpoints.{
  ConfirmMatchRequest, ConfirmMatchResponse, DeleteMatchResponse, MatchDetailResponse,
  MatchListResponse, MatchListSummaryResponse, MatchSummaryResponse, MatchesEndpoints,
  PaginationResponse, UpdateMatchRequest,
}
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay}
import momo.api.usecases.{ConfirmMatch, DeleteMatch, GetMatch, ListMatches, UpdateMatch}

object MatchModule:
  def routes[F[_]: Async](
      confirmMatch: ConfirmMatch[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      deleteMatch: DeleteMatch[F],
      readRateLimiter: RateLimiter[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    MatchesEndpoints.confirm.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, ConfirmMatchRequest, ConfirmMatchResponse](
          idempotency,
          idemKey,
          member,
          HttpOperation.ConfirmMatch,
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
      case (
            heldEventId,
            gameTitleId,
            seasonMasterId,
            status,
            kind,
            limit,
            page,
            pageSize,
            sort,
            accountHeader,
          ) => security.authorizeRead(accountHeader) { member =>
          ReadRateLimit.enforce(readRateLimiter, member.accountId.value, HttpOperation.ListMatches) {
            security.decode(MatchListCodec.toListCommand(
              heldEventId,
              gameTitleId,
              seasonMasterId,
              status,
              kind,
              limit,
              page,
              pageSize,
              sort,
            ))(command =>
              security.respond(listMatches.run(command))(result =>
                MatchListResponse(
                  items = result.items.map(MatchSummaryResponse.from),
                  pagination = PaginationResponse.from(result),
                )
              )
            )
          }
        }
    },
    MatchesEndpoints.summary.serverLogic {
      case (heldEventId, gameTitleId, seasonMasterId, accountHeader) => security
          .authorizeRead(accountHeader) { member =>
            ReadRateLimit
              .enforce(readRateLimiter, member.accountId.value, HttpOperation.SummarizeMatches) {
                security.decode(
                  MatchListCodec.parseSummaryFilter(heldEventId, gameTitleId, seasonMasterId)
                ) { case (parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId) =>
                  security.respond(
                    listMatches
                      .summarize(parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId)
                  )(MatchListSummaryResponse.from)
                }
              }
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
              HttpOperation.UpdateMatch,
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
          HttpOperation.DeleteMatch,
          matchId,
          nowF,
          security.decode(BoundaryId.required("matchId", matchId)(MatchId.fromString))(id =>
            security.respond(deleteMatch.run(id))(_ => DeleteMatchResponse(matchId, deleted = true))
          ),
        )
      }
    },
  )
