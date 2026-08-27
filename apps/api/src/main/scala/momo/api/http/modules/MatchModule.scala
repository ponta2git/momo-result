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
  MatchListPaginationResponse,
  MatchListResponse,
  MatchListSummaryResponse,
  MatchSummaryResponse,
  MatchesEndpoints,
  ReplaceMatchNoteRequest,
  ReplaceMatchNoteResponse,
  UpdateMatchRequest,
  UpdateMatchResponse
}
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.matches.{
  ConfirmMatch,
  DeleteMatch,
  GetMatch,
  ListMatches,
  ListMatchesPagination,
  ReplaceMatchNote,
  UpdateMatch
}

object MatchModule:
  def routes[F[_]: Async](
      confirmMatch: ConfirmMatch[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      replaceMatchNote: ReplaceMatchNote[F],
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
              pageSize,
              cursor,
              sort,
            ) =>
          ReadRateLimit.enforce(readRateLimiter, member.accountId.value, HttpOperation.ListMatches) {
            security.decode(MatchListCodec.toListCommand(
              heldEventId,
              gameTitleId,
              seasonMasterId,
              status,
              kind,
              pageSize,
              cursor,
              sort,
            ))(command =>
              security.respond(listMatches.run(command, member.accountId))(result =>
                MatchListResponse(
                  items = result.items.map(MatchSummaryResponse.from),
                  pagination = paginationResponse(result.pagination),
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
          IdempotencyReplay.wrap[F, (String, UpdateMatchRequest), UpdateMatchResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.UpdateMatch,
            (matchId, request),
            nowF,
            security.decode(BoundaryId.required("matchId", matchId)(MatchId.fromString)) { id =>
              security.decode(MatchCodec.toUpdateCommand(request))(command =>
                security.respond(updateMatch.run(id, command))(record =>
                  UpdateMatchResponse(
                    matchId = record.id.value,
                    heldEventId = record.heldEventId.value,
                    matchNoInEvent = record.matchNoInEvent.value,
                  )
                )
              )
            },
          )
      }
    },
    SecuredEndpoint.mutationLogic(security, MatchesEndpoints.replaceNote) { member =>
      {
        case (matchId, idemKey, request) =>
          IdempotencyReplay.wrap[F, (String, ReplaceMatchNoteRequest), ReplaceMatchNoteResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.ReplaceMatchNote,
            (matchId, request),
            nowF,
            security.decode(BoundaryId.required("matchId", matchId)(MatchId.fromString)) { id =>
              security.decode(MatchCodec.toReplaceNoteCommand(request)) { command =>
                security.respond(replaceMatchNote.run(id, command, member.accountId))(note =>
                  ReplaceMatchNoteResponse(
                    matchId = matchId,
                    version = note.version.value.toString,
                  )
                )
              }
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

  private def paginationResponse(value: ListMatchesPagination): MatchListPaginationResponse =
    MatchListPaginationResponse(
      page = value.page,
      pageSize = value.pageSize,
      totalItems = value.totalItems,
      totalPages = value.totalPages,
      hasPreviousPage = value.hasPreviousPage,
      hasNextPage = value.hasNextPage,
      previousCursor = value.previousCursor,
      nextCursor = value.nextCursor,
      lastCursor = value.lastCursor,
    )
