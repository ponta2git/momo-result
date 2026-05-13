package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{OcrDraftId, OcrJobId}
import momo.api.endpoints.codec.{OcrDraftCodec, OcrJobCodec}
import momo.api.endpoints.{
  CancelOcrJobResponse, CreateOcrJobRequest, OcrDraftEndpoints, OcrDraftListResponse,
  OcrDraftResponse, OcrJobEndpoints, OcrJobResponse,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{CancelOcrJob, CreateOcrJob, GetOcrDraft, GetOcrDraftsBulk, GetOcrJob}

object OcrModule:
  def routes[F[_]: Async](
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      cancelOcrJob: CancelOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      getOcrDraftsBulk: GetOcrDraftsBulk[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    OcrJobEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateOcrJobRequest, momo.api.endpoints.CreateOcrJobResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/ocr-jobs",
          request,
          nowF,
          security.respond(
            createOcrJob.run(OcrJobCodec.toCreateCommand(request))
          )(OcrJobCodec.toCreateResponse),
        )
      }
    },
    OcrJobEndpoints.get.serverLogic { case (jobId, accountHeader) =>
      security.authorizeRead(accountHeader)(_ =>
        security.respond(getOcrJob.run(OcrJobId.unsafeFromString(jobId)))(OcrJobResponse.from)
      )
    },
    OcrJobEndpoints.cancel.serverLogic { case (jobId, accountHeader, csrfToken) =>
      security.authorizeMutation(accountHeader, csrfToken) { _ =>
        security.respond(
          cancelOcrJob.run(OcrJobId.unsafeFromString(jobId))
        )(_ => CancelOcrJobResponse(jobId, "cancelled"))
      }
    },
    OcrDraftEndpoints.get.serverLogic { case (draftId, accountHeader) =>
      security.authorizeRead(accountHeader)(_ =>
        security
          .respond(getOcrDraft.run(OcrDraftId.unsafeFromString(draftId)))(OcrDraftResponse.from)
      )
    },
    OcrDraftEndpoints.listByIds.serverLogic { case (ids, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        security.respond(
          OcrDraftCodec.toDraftIds(ids) match
            case Left(error) => Async[F].pure(Left(error))
            case Right(draftIds) => getOcrDraftsBulk.run(draftIds)
        )(items => OcrDraftListResponse(items.map(OcrDraftResponse.from)))
      }
    },
  )
