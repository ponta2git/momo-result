package momo.api.http.modules

import java.time.format.DateTimeFormatter

import sttp.tapir.server.ServerEndpoint

import momo.api.domain.PublicId
import momo.api.domain.ids.MatchId
import momo.api.endpoints.codec.{BoundaryId, MatchCodec, MatchListCodec}
import momo.api.endpoints.{
  ConfirmMatchResponse,
  DeleteMatchResponse,
  MatchDetailResponse,
  MatchIdentityResponse,
  MatchListPaginationResponse,
  MatchListResponse,
  MatchListSummaryResponse,
  MatchSummaryResponse,
  MatchesEndpoints,
  ReplaceMatchNoteResponse,
  UpdateMatchResponse
}
import momo.api.errors.AppError
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
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
  final case class UseCases[F[_]](
      confirmMatch: ConfirmMatch[F],
      listMatches: ListMatches[F],
      getMatch: GetMatch[F],
      updateMatch: UpdateMatch[F],
      replaceMatchNote: ReplaceMatchNote[F],
      deleteMatch: DeleteMatch[F],
  )

  def routes[F[_]](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.mutationLogic(security, MatchesEndpoints.confirm) { member =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.ConfirmMatch,
              idemKey,
              member,
              request,
            )(
              MatchCodec.toConfirmCommand(request)
            )(command =>
              confirmMatch.run(command, member.accountId, member.playerMemberId)
            )(record =>
              ConfirmMatchResponse(
                matchId = record.id.value,
                heldEventId = record.heldEventId.value,
                matchNoInEvent = record.matchNoInEvent.value,
                createdAt = DateTimeFormatter.ISO_INSTANT.format(record.createdAt),
              )
            )
        }
      },
      SecuredEndpoint.readLogic(security, MatchesEndpoints.list) { member => input =>
        execution.execute(
          MatchListCodec.toListCommand(
            heldEventId = input.heldEventId,
            gameTitleId = input.gameTitleId,
            seasonMasterId = input.seasonMasterId,
            status = input.status,
            kind = input.kind,
            pageSize = input.pageSize,
            cursor = input.cursor,
            sort = input.sort,
          )
        )(command => listMatches.run(command, member.accountId))(result =>
          MatchListResponse(
            items = result.items.map(MatchSummaryResponse.from),
            pagination = paginationResponse(result.pagination),
          )
        )
      },
      SecuredEndpoint.readLogic(security, MatchesEndpoints.summary) { _ => input =>
        execution.execute(
          MatchListCodec.parseSummaryFilter(
            heldEventId = input.heldEventId,
            gameTitleId = input.gameTitleId,
            seasonMasterId = input.seasonMasterId,
          )
        ) { case (parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId) =>
          listMatches.summarize(parsedHeldEventId, parsedGameTitleId, parsedSeasonMasterId)
        }(
          MatchListSummaryResponse.from
        )
      },
      SecuredEndpoint.readLogic(security, MatchesEndpoints.get) { _ => matchId =>
        execution.execute(
          BoundaryId.required("matchId", matchId)(MatchId.fromString)
        )(id => getMatch.run(id))(
          MatchDetailResponse.from
        )
      },
      SecuredEndpoint.readLogic(security, MatchesEndpoints.identity) { _ => matchId =>
        execution.execute(
          BoundaryId.required("matchId", matchId)(MatchId.fromString)
        )(id => getMatch.identity(id))(
          MatchIdentityResponse.from
        )
      },
      SecuredEndpoint.readLogic(security, MatchesEndpoints.getByPublicId) { _ => publicId =>
        execution.execute(
          PublicId.fromString(publicId).left.map(_ =>
            AppError.ValidationFailed("publicId is invalid.")
          )
        )(getMatch.byPublicId)(MatchDetailResponse.from)
      },
      SecuredEndpoint.mutationLogic(security, MatchesEndpoints.update) { member =>
        {
          case (matchId, idemKey, request) =>
            execution.mutation(
              HttpOperation.UpdateMatch,
              idemKey,
              member,
              (matchId, request),
            )(
              for
                id <- BoundaryId.required("matchId", matchId)(MatchId.fromString)
                command <- MatchCodec.toUpdateCommand(request)
              yield (id, command)
            ) { case (id, command) =>
              updateMatch.run(id, command, Some(member.accountId))
            }(record =>
              UpdateMatchResponse(
                matchId = record.id.value,
                heldEventId = record.heldEventId.value,
                matchNoInEvent = record.matchNoInEvent.value,
              )
            )
        }
      },
      SecuredEndpoint.mutationLogic(security, MatchesEndpoints.replaceNote) { member =>
        {
          case (matchId, idemKey, request) =>
            execution.mutation(
              HttpOperation.ReplaceMatchNote,
              idemKey,
              member,
              (matchId, request),
            )(
              for
                id <- BoundaryId.required("matchId", matchId)(MatchId.fromString)
                command <- MatchCodec.toReplaceNoteCommand(request)
              yield (id, command)
            ) { case (id, command) =>
              replaceMatchNote.run(id, command, member.accountId)
            }(note =>
              ReplaceMatchNoteResponse(
                matchId = matchId,
                version = note.version.value.toString,
              )
            )
        }
      },
      SecuredEndpoint.mutationLogic(security, MatchesEndpoints.delete) { member =>
        {
          case (matchId, idemKey) =>
            execution.mutation(
              HttpOperation.DeleteMatch,
              idemKey,
              member,
              matchId,
            )(
              BoundaryId.required("matchId", matchId)(MatchId.fromString)
            )(id =>
              deleteMatch.run(id, Some(member.accountId))
            )(_ =>
              DeleteMatchResponse(matchId, deleted = true)
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
