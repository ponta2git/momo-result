package momo.api.http.modules

import java.time.Instant
import java.time.format.DateTimeFormatter

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.ids.MatchId
import momo.api.endpoints.codec.{BoundaryId, MatchCodec, MatchListCodec}
import momo.api.endpoints.{
  ConfirmMatchRequest,
  ConfirmMatchResponse,
  DeleteMatchResponse,
  MatchDetailResponse,
  MatchListResponse,
  MatchListSummaryResponse,
  MatchSummaryResponse,
  MatchesEndpoints,
  PaginationResponse,
  UpdateMatchRequest
}
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
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
    SecuredEndpoint.mutationLogic(security, MatchesEndpoints.confirm) { member =>
      {
        case (idemKey, request) =>
          IdempotencyReplay.wrap[F, ConfirmMatchRequest, ConfirmMatchResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.ConfirmMatch,
            request,
            nowF,
            security.decode(MatchCodec.toConfirmCommand(request))(command =>
              security
                .respond(confirmMatch.run(command, member.accountId, member.playerMemberId))(
                  record =>
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
    SecuredEndpoint.readLogic(security, MatchesEndpoints.list) { member =>
      {
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
            ) =>
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
    SecuredEndpoint.readLogic(security, MatchesEndpoints.summary) { member =>
      {
        case (heldEventId, gameTitleId, seasonMasterId) =>
          ReadRateLimit
            .enforce(readRateLimiter, member.accountId.value, HttpOperation.SummarizeMatches) {
              security.decode(
                MatchListCodec.parseSummaryFilter(heldEventId, gameTitleId, seasonMasterId)
              ) { case (parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId) =>
                security.respond(
                  listMatches.summarize(parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId)
                )(MatchListSummaryResponse.from)
              }
            }
      }
    },
    SecuredEndpoint.readLogic(security, MatchesEndpoints.get) { _ => matchId =>
      security.decode(
        BoundaryId.required("matchId", matchId)(MatchId.fromString)
      )(id => security.respond(getMatch.run(id))(MatchDetailResponse.from))
    },
    SecuredEndpoint.mutationLogic(security, MatchesEndpoints.update) { member =>
      {
        case (matchId, idemKey, request) =>
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
    SecuredEndpoint.mutationLogic(security, MatchesEndpoints.delete) { member =>
      {
        case (matchId, idemKey) =>
          IdempotencyReplay.wrap[F, String, DeleteMatchResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.DeleteMatch,
            matchId,
            nowF,
            security.decode(BoundaryId.required("matchId", matchId)(MatchId.fromString))(id =>
              security.respond(deleteMatch.run(id))(_ =>
                DeleteMatchResponse(matchId, deleted = true)
              )
            ),
          )
      }
    },
  )
