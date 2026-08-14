package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import org.slf4j.LoggerFactory
import sttp.capabilities.fs2.Fs2Streams
import sttp.tapir.server.ServerEndpoint

import momo.api.auth.RateLimiter
import momo.api.domain.RequestId
import momo.api.domain.ids.MatchDraftId
import momo.api.endpoints.codec.{BoundaryId, MatchDraftCodec}
import momo.api.endpoints.{
  CancelMatchDraftResponse,
  CreateMatchDraftRequest,
  MatchDraftDetailResponse,
  MatchDraftEndpoints,
  MatchDraftResponse,
  MatchDraftSourceImageListResponse,
  MatchDraftSourceImageResponse,
  ProblemDetails,
  UpdateMatchDraftRequest
}
import momo.api.http.{
  EndpointSecurity,
  HttpDownloadHeaders,
  HttpOperation,
  IdempotencyReplay,
  SecuredEndpoint,
  SourceImageTransferContext,
  SourceImageTransferLogging
}
import momo.api.usecases.matchdrafts.{
  CancelMatchDraft,
  CreateMatchDraft,
  GetMatchDraft,
  GetMatchDraftSourceImages,
  UpdateMatchDraft
}

object MatchDraftModule:
  private val logger = LoggerFactory.getLogger("momo.api.http.modules.MatchDraftModule")

  def routes[F[_]: Async](
      createMatchDraft: CreateMatchDraft[F],
      getMatchDraft: GetMatchDraft[F],
      updateMatchDraft: UpdateMatchDraft[F],
      cancelMatchDraft: CancelMatchDraft[F],
      getMatchDraftSourceImages: GetMatchDraftSourceImages[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.mutationLogic(security, MatchDraftEndpoints.create) { member =>
      {
        case (idemKey, request) =>
          IdempotencyReplay.wrap[F, CreateMatchDraftRequest, MatchDraftResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.CreateMatchDraft,
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
    SecuredEndpoint.mutationLogic(security, MatchDraftEndpoints.update) { member =>
      {
        case (draftId, idemKey, request) =>
          IdempotencyReplay.wrap[F, (String, UpdateMatchDraftRequest), MatchDraftResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.UpdateMatchDraft,
            (draftId, request),
            nowF,
            MatchDraftCodec.parseInstantOption[F](request.playedAt).flatMap {
              case Left(error) => security.toProblemF(error).map(Left(_))
              case Right(playedAt) => security
                  .decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)) {
                    id =>
                      security.decode(MatchDraftCodec.toUpdateCommand(request, playedAt)) { command =>
                        security.respond(updateMatchDraft.run(id, command))(MatchDraftResponse.from)
                      }
                  }
            },
          )
      }
    },
    SecuredEndpoint.readLogic(security, MatchDraftEndpoints.get) { _ => draftId =>
      security.decode(
        BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)
      )(id => security.respond(getMatchDraft.run(id))(MatchDraftDetailResponse.from))
    },
    SecuredEndpoint.mutationLogic(security, MatchDraftEndpoints.cancel) { member =>
      {
        case (draftId, idemKey) =>
          IdempotencyReplay.wrap[F, String, CancelMatchDraftResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.CancelMatchDraft,
            draftId,
            nowF,
            security
              .decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)) { id =>
                security.respond(
                  cancelMatchDraft.run(id)
                )(_ => CancelMatchDraftResponse(matchDraftId = draftId, status = "cancelled"))
              },
          )
      }
    },
    SecuredEndpoint.readLogic(security, MatchDraftEndpoints.listSourceImages) { _ => draftId =>
      security.decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString))(id =>
        security.respond(getMatchDraftSourceImages.list(id))(items =>
          MatchDraftSourceImageListResponse(items.map(MatchDraftSourceImageResponse.from))
        )
      )
    },
  )

  def sourceImageRoutes[F[_]: Async](
      getMatchDraftSourceImages: GetMatchDraftSourceImages[F],
      sourceImageDownloadRateLimiter: RateLimiter[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Fs2Streams[F], F]] = List(
    SecuredEndpoint.readLogic(security, MatchDraftEndpoints.downloadSourceImagesStream[F]) {
      member => (draftId, rawRequestId) =>
        val requestId = normalizedRequestId(rawRequestId)
        security.decode(BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString))(id =>
          sourceImageDownloadRateLimiter.allow(s"source-image-download:${member.accountId.value}")
            .flatMap {
              case false =>
                sourceImageRateLimited[F, MatchDraftEndpoints.SourceImageArchiveStreamOutput[F]](
                  route = "archive",
                  accountId = member.accountId.value,
                  draftId = id.value,
                  detail = None,
                )
              case true => getMatchDraftSourceImages.archive(id, member.accountId).flatMap {
                  case Left(error) => security.toProblemF(error).map(Left(_))
                  case Right(archive) =>
                    HttpDownloadHeaders.attachment(archive.fileName) match
                      case Left(error) => security.toProblemF(error).map(Left(_))
                      case Right(disposition) => Async[F].pure(Right((
                          archive.contentType,
                          disposition,
                          HttpDownloadHeaders.PrivateNoStore,
                          HttpDownloadHeaders.Nosniff,
                          SourceImageTransferLogging.observe(
                            archive.body,
                            SourceImageTransferContext(
                              requestId = requestId,
                              event = "source_image_archive_transfer_completed",
                              fields =
                                s"accountId=${member.accountId.value} draftId=${id.value} " +
                                  s"imageCount=${archive.imageCount.toString} " +
                                  s"expectedArchiveBytes=${archive.archiveBytes.toString}",
                            ),
                          ),
                        )))
                }
            }
        )
    },
    SecuredEndpoint.readLogic(security, MatchDraftEndpoints.getSourceImageStream[F]) { member =>
      {
        case (draftId, kind, rawRequestId) =>
          val requestId = normalizedRequestId(rawRequestId)
          val decoded =
            for
              id <- BoundaryId.required("matchDraftId", draftId)(MatchDraftId.fromString)
              parsedKind <- MatchDraftCodec.parseSourceImageKind(kind)
            yield (id, parsedKind)
          security.decode(decoded) { case (id, parsedKind) =>
            sourceImageDownloadRateLimiter.allow(s"source-image-download:${member.accountId.value}")
              .flatMap {
                case false => sourceImageRateLimited[F, MatchDraftEndpoints.SourceImageStreamOutput[
                    F
                  ]](
                    route = "image",
                    accountId = member.accountId.value,
                    draftId = id.value,
                    detail = Some(parsedKind.wire),
                  )
                case true => getMatchDraftSourceImages.stream(id, parsedKind).flatMap {
                    case Left(error) => security.toProblemF(error).map(Left(_))
                    case Right(image) =>
                      Async[F].pure(Right((
                        image.contentType,
                        HttpDownloadHeaders.PrivateNoStore,
                        HttpDownloadHeaders.Nosniff,
                        SourceImageTransferLogging.observe(
                          image.body,
                          SourceImageTransferContext(
                            requestId = requestId,
                            event = "source_image_transfer_completed",
                            fields =
                              s"accountId=${member.accountId.value} draftId=${id.value} " +
                                s"kind=${parsedKind.wire} " +
                                s"expectedBodyBytes=${image.bodyBytes.toString}",
                          ),
                        ),
                      )))
                  }
              }
          }
      }
    },
  )

  private def normalizedRequestId(raw: Option[String]): String = raw.flatMap(RequestId.sanitize)
    .getOrElse("none")

  private def sourceImageRateLimited[F[_]: Async, A](
      route: String,
      accountId: String,
      draftId: String,
      detail: Option[String],
  ): F[Either[ProblemDetails.ProblemResponse, A]] = Async[F].delay {
    val suffix = detail.fold("")(value => s" detail=$value")
    logger.warn(
      s"source_image_download_rate_limited route=$route accountId=$accountId draftId=$draftId$suffix"
    )
  } *> Async[F].pure(Left(securityProblem("元画像の取得が短時間に集中しています。少し待ってから再度お試しください。")))

  private def securityProblem(detail: String) = ProblemDetails
    .from(momo.api.errors.AppError.TooManyRequests(detail))
