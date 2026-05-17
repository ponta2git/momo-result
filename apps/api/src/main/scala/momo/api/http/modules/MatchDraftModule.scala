package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.MatchDraftId
import momo.api.endpoints.codec.{BoundaryId, MatchDraftCodec}
import momo.api.endpoints.{
  CancelMatchDraftResponse, CreateMatchDraftRequest, MatchDraftDetailResponse, MatchDraftEndpoints,
  MatchDraftResponse, MatchDraftSourceImageListResponse, MatchDraftSourceImageResponse,
  UpdateMatchDraftRequest,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{
  CancelMatchDraft, CreateMatchDraft, GetMatchDraft, GetMatchDraftSourceImages, UpdateMatchDraft,
}

object MatchDraftModule:
  def routes[F[_]: Async](
      createMatchDraft: CreateMatchDraft[F],
      getMatchDraft: GetMatchDraft[F],
      updateMatchDraft: UpdateMatchDraft[F],
      cancelMatchDraft: CancelMatchDraft[F],
      getMatchDraftSourceImages: GetMatchDraftSourceImages[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    MatchDraftEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateMatchDraftRequest, MatchDraftResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/match-drafts",
          request,
          nowF,
          MatchDraftCodec.parseInstantOption[F](request.playedAt).flatMap {
            case Left(error) => security.toProblemF(error).map(Left(_))
            case Right(playedAt) => MatchDraftCodec.toCreateCommand(request, playedAt) match
                case Left(error) => security.toProblemF(error).map(Left(_))
                case Right(command) => security.respond(
                    createMatchDraft.run(command, member.accountId, member.playerMemberId)
                  )(MatchDraftResponse.from)
          },
        )
      }
    },
    MatchDraftEndpoints.update.serverLogic {
      case (draftId, accountHeader, csrfToken, idemKey, request) => security
          .authorizeMutation(accountHeader, csrfToken) { member =>
            IdempotencyReplay.wrap[F, (String, UpdateMatchDraftRequest), MatchDraftResponse](
              idempotency,
              idemKey,
              member,
              "PATCH /api/match-drafts/:id",
              (draftId, request),
              nowF,
              MatchDraftCodec.parseInstantOption[F](request.playedAt).flatMap {
                case Left(error) => security.toProblemF(error).map(Left(_))
                case Right(playedAt) => security
                    .decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)) {
                      id =>
                        security
                          .decode(MatchDraftCodec.toUpdateCommand(request, playedAt)) { command =>
                            security.respond(
                              updateMatchDraft.run(id, command, member.accountId)
                            )(MatchDraftResponse.from)
                          }
                    }
              },
            )
          }
    },
    MatchDraftEndpoints.get.serverLogic { case (draftId, accountHeader) =>
      security.authorizeRead(accountHeader) { member =>
        security.decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString))(id =>
          security.respond(getMatchDraft.run(id, member.accountId))(MatchDraftDetailResponse.from)
        )
      }
    },
    MatchDraftEndpoints.cancel.serverLogic { case (draftId, accountHeader, csrfToken, idemKey) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, CancelMatchDraftResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/match-drafts/:id/cancel",
          draftId,
          nowF,
          security
            .decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)) { id =>
              security.respond(
                cancelMatchDraft.run(id, member.accountId)
              )(_ => CancelMatchDraftResponse(matchDraftId = draftId, status = "cancelled"))
            },
        )
      }
    },
    MatchDraftEndpoints.listSourceImages.serverLogic { case (draftId, accountHeader) =>
      security.authorizeRead(accountHeader) { member =>
        security.decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString))(id =>
          security.respond(getMatchDraftSourceImages.list(id, member.accountId))(items =>
            MatchDraftSourceImageListResponse(items.map(MatchDraftSourceImageResponse.from))
          )
        )
      }
    },
    MatchDraftEndpoints.getSourceImage.serverLogic { case (draftId, kind, accountHeader) =>
      security.authorizeRead(accountHeader) { member =>
        val decoded =
          for
            id <- BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)
            parsedKind <- MatchDraftCodec.parseSourceImageKind(kind)
          yield (id, parsedKind)
        security.decode(decoded) { case (id, parsedKind) =>
          security.respond(
            getMatchDraftSourceImages.stream(id, parsedKind, member.accountId)
          )(image => (image.contentType, "private, no-store", "nosniff", image.bytes))
        }
      }
    },
  )
