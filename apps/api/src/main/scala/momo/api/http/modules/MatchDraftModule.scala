package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.MatchDraftId
import momo.api.endpoints.codec.MatchDraftCodec
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
            case Left(error) => Async[F].pure(Left(security.toProblem(error)))
            case Right(playedAt) => MatchDraftCodec.toCreateCommand(request, playedAt) match
                case Left(error) => Async[F].pure(Left(security.toProblem(error)))
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
            IdempotencyReplay.wrap[F, UpdateMatchDraftRequest, MatchDraftResponse](
              idempotency,
              idemKey,
              member,
              s"PATCH /api/match-drafts/$draftId",
              request,
              nowF,
              MatchDraftCodec.parseInstantOption[F](request.playedAt).flatMap {
                case Left(error) => Async[F].pure(Left(security.toProblem(error)))
                case Right(playedAt) => security.respond(updateMatchDraft.run(
                    MatchDraftId.unsafeFromString(draftId),
                    MatchDraftCodec.toUpdateCommand(request, playedAt),
                    member.accountId,
                  ))(MatchDraftResponse.from)
              },
            )
          }
    },
    MatchDraftEndpoints.get.serverLogic { case (draftId, accountHeader) =>
      security.authorizeRead(accountHeader) { member =>
        security.respond(
          getMatchDraft.run(MatchDraftId.unsafeFromString(draftId), member.accountId)
        )(MatchDraftDetailResponse.from)
      }
    },
    MatchDraftEndpoints.cancel.serverLogic { case (draftId, accountHeader, csrfToken, idemKey) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, String, CancelMatchDraftResponse](
          idempotency,
          idemKey,
          member,
          s"POST /api/match-drafts/$draftId/cancel",
          draftId,
          nowF,
          security.respond(
            cancelMatchDraft.run(MatchDraftId.unsafeFromString(draftId), member.accountId)
          )(_ => CancelMatchDraftResponse(matchDraftId = draftId, status = "cancelled")),
        )
      }
    },
    MatchDraftEndpoints.listSourceImages.serverLogic { case (draftId, accountHeader) =>
      security.authorizeRead(accountHeader) { member =>
        security.respond(
          getMatchDraftSourceImages.list(MatchDraftId.unsafeFromString(draftId), member.accountId)
        )(items => MatchDraftSourceImageListResponse(items.map(MatchDraftSourceImageResponse.from)))
      }
    },
    MatchDraftEndpoints.getSourceImage.serverLogic { case (draftId, kind, accountHeader) =>
      security.authorizeRead(accountHeader) { member =>
        security.respond(
          getMatchDraftSourceImages
            .stream(MatchDraftId.unsafeFromString(draftId), kind, member.accountId)
        )(image => (image.contentType, "private, no-store", "nosniff", image.bytes))
      }
    },
  )
