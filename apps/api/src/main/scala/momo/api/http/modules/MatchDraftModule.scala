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
import momo.api.http.{EndpointSecurity, IdempotencyHandler}
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
    MatchDraftEndpoints.create.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, CreateMatchDraftRequest, MatchDraftResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/match-drafts",
          request,
          nowF,
          MatchDraftCodec.parseInstantOption[F](request.playedAt).flatMap {
            case Left(error) => Async[F].pure(Left(security.toProblem(error)))
            case Right(playedAt) => security.respond(
                createMatchDraft
                  .run(MatchDraftCodec.toCreateCommand(request, playedAt), member.memberId)
              )(MatchDraftResponse.from)
          },
        )
      }
    },
    MatchDraftEndpoints.update.serverLogic { case (draftId, devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, UpdateMatchDraftRequest, MatchDraftResponse](
          idempotency,
          idemKey,
          member,
          s"PATCH /api/match-drafts/$draftId",
          request,
          nowF,
          MatchDraftCodec.parseInstantOption[F](request.playedAt).flatMap {
            case Left(error) => Async[F].pure(Left(security.toProblem(error)))
            case Right(playedAt) => security.respond(updateMatchDraft.run(
                MatchDraftId(draftId),
                MatchDraftCodec.toUpdateCommand(request, playedAt),
                member.memberId,
              ))(MatchDraftResponse.from)
          },
        )
      }
    },
    MatchDraftEndpoints.get.serverLogic { case (draftId, devUser) =>
      security.authorizeRead(devUser) { member =>
        security.respond(
          getMatchDraft.run(MatchDraftId(draftId), member.memberId)
        )(MatchDraftDetailResponse.from)
      }
    },
    MatchDraftEndpoints.cancel.serverLogic { case (draftId, devUser, csrfToken) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        security.respond(
          cancelMatchDraft.run(MatchDraftId(draftId), member.memberId)
        )(_ => CancelMatchDraftResponse(matchDraftId = draftId, status = "cancelled"))
      }
    },
    MatchDraftEndpoints.listSourceImages.serverLogic { case (draftId, devUser) =>
      security.authorizeRead(devUser) { member =>
        security.respond(
          getMatchDraftSourceImages.list(MatchDraftId(draftId), member.memberId)
        )(items => MatchDraftSourceImageListResponse(items.map(MatchDraftSourceImageResponse.from)))
      }
    },
    MatchDraftEndpoints.getSourceImage.serverLogic { case (draftId, kind, devUser) =>
      security.authorizeRead(devUser) { member =>
        security.respond(
          getMatchDraftSourceImages.stream(MatchDraftId(draftId), kind, member.memberId)
        )(image => ("private, no-store", "nosniff", image.bytes))
      }
    },
  )
