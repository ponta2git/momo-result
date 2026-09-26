package momo.api.http

import cats.data.Kleisli
import cats.effect.kernel.Poll
import cats.effect.std.Semaphore
import cats.effect.{Async, Resource}
import cats.syntax.all.*
import org.http4s.{Header, HttpApp, Method, Request, Response}
import org.typelevel.ci.CIString

import momo.api.errors.AppError

/** Bounds request decoding and large response buffers, including slow downloads. */
final class RequestBodyAdmission[F[_]: Async] private (
    uploads: Semaphore[F],
    mutations: Semaphore[F],
    downloads: Semaphore[F],
    exports: Semaphore[F],
    reads: Semaphore[F],
    waitingReads: Semaphore[F],
):
  private given CanEqual[Resource.ExitCase, Resource.ExitCase] = CanEqual.derived

  def apply(http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    if isImageDownload(request) then
      responseLifetime(downloads, _ => downloads.tryAcquire, http, request)
    else if isExport(request) then responseLifetime(exports, _ => exports.tryAcquire, http, request)
    else if !HttpMethodPredicates.isMutating(request.method) then
      if isDataRead(request) then read(http, request)
      else http.run(request)
    else
      val semaphore =
        if HttpRequestPaths.isImageUpload(request) then uploads else mutations
      // Resource masks the acquisition/release boundary. Rejected requests never enter the
      // decoder or join an unbounded queue retaining their bodies.
      Resource.make(semaphore.tryAcquire)(acquired =>
        if acquired then semaphore.release else Async[F].unit
      ).use {
        case true => http.run(request)
        case false => Async[F].pure(busy)
      }
  }

  private def read(http: HttpApp[F], request: Request[F]): F[Response[F]] =
    // A screen fetches several JSON resources together. Bound the waiters before queueing
    // without allocating response projections, so a normal burst can share the read budget.
    responseLifetime(
      reads,
      poll =>
        waitingReads.tryAcquire.flatMap {
          case false => Async[F].pure(false)
          case true => Async[F].guarantee(poll(reads.acquire), waitingReads.release).as(true)
        },
      http,
      request
    )

  private def responseLifetime(
      semaphore: Semaphore[F],
      acquire: Poll[F] => F[Boolean],
      http: HttpApp[F],
      request: Request[F],
  ): F[Response[F]] =
    // Like http4s BracketRequestResponse, a successful handler transfers resource ownership
    // to the response body. The server must evaluate the body even when it is empty.
    Resource.makeCaseFull[F, Boolean](acquire) {
      case (true, Resource.ExitCase.Canceled | Resource.ExitCase.Errored(_)) => semaphore.release
      case _ => Async[F].unit
    }.use {
      case false => Async[F].pure(busy)
      case true => http.run(request).map(response =>
          response.withBodyStream(response.body.onFinalize(semaphore.release))
        )
    }

  private def isImageDownload(request: Request[F]): Boolean =
    request.method.name == Method.GET.name &&
      (HttpRequestPaths.segments(request) match
        case List("api", "match-drafts", _, "source-images", _) => true
        case List("api", "match-drafts", _, "source-images.zip") => true
        case _ => false)

  private def isExport(request: Request[F]): Boolean =
    request.method.name == Method.GET.name &&
      HttpRequestPaths.segments(request) == List("api", "exports", "matches")

  private def isDataRead(request: Request[F]): Boolean = HttpRequestPaths.segments(request) match
    // Authentication has bounded, small responses and must remain usable during data pressure.
    case "api" :: "auth" :: _ => false
    case "api" :: _ => true
    case _ => false

  private def busy: Response[F] = HttpProblemResponse.fromError[F](AppError.ServiceUnavailable(
    "Request capacity is temporarily busy. Try again shortly."
  )).putHeaders(Header.Raw(CIString("Retry-After"), "1"))

object RequestBodyAdmission:
  // Uploads retain multipart bytes and SDK buffers in addition to the image itself. Separate
  // lanes leave room for ordinary writes while object I/O or a slow download is in progress.
  def create[F[_]: Async]: F[RequestBodyAdmission[F]] = create(2L, 4L, 2L, 1L, 2L)

  private[http] def create[F[_]: Async](
      uploadConcurrency: Long,
      mutationConcurrency: Long,
      downloadConcurrency: Long,
      exportConcurrency: Long,
      readConcurrency: Long,
  ): F[RequestBodyAdmission[F]] =
    if uploadConcurrency <= 0L || mutationConcurrency <= 0L || downloadConcurrency <= 0L ||
      exportConcurrency <= 0L || readConcurrency <= 0L
    then
      Async[F].raiseError(new IllegalArgumentException("Request body concurrency must be positive"))
    else
      (
        Semaphore[F](uploadConcurrency),
        Semaphore[F](mutationConcurrency),
        Semaphore[F](downloadConcurrency),
        Semaphore[F](exportConcurrency),
        Semaphore[F](readConcurrency),
        Semaphore[F](16L),
      ).mapN(new RequestBodyAdmission(_, _, _, _, _, _))
