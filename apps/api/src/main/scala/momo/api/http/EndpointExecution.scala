package momo.api.http

import java.time.Instant

import cats.effect.Async
import io.circe.{Decoder, Encoder}

import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.ProblemDetails.ProblemResponse
import momo.api.errors.AppError

/** Runs decoded application commands and preserves the HTTP mutation replay boundary. */
private[http] final class EndpointExecution[F[_]: Async](
    security: EndpointSecurity[F],
    idempotency: IdempotencyReplay.Guard[F],
    now: F[Instant],
):
  def execute[C, A, O](decoded: Either[AppError, C])(
      run: C => F[Either[AppError, A]]
  )(render: A => O): F[Either[ProblemResponse, O]] =
    security.decode(decoded)(command => security.respond(run(command))(render))

  /** The raw request identifies retries; command decoding and execution belong to a fresh request. */
  def mutation[Req: Encoder, C, A, Resp: Encoder: Decoder](
      operation: String,
      key: Option[String],
      account: AuthenticatedAccount,
      request: Req,
  )(decoded: => Either[AppError, C])(
      run: C => F[Either[AppError, A]]
  )(render: A => Resp): F[Either[ProblemResponse, Resp]] =
    replay(operation, key, account, request)(execute(decoded)(run)(render))

  /** Specialized endpoints keep their preparation and fresh-only effects around this shared gate. */
  def replay[Req: Encoder, Resp: Encoder: Decoder](
      operation: String,
      key: Option[String],
      account: AuthenticatedAccount,
      request: Req,
  )(run: => F[Either[ProblemResponse, Resp]]): F[Either[ProblemResponse, Resp]] =
    IdempotencyReplay.wrap(idempotency, key, account, operation, request, now, Async[F].defer(run))

private[http] final case class HttpRouteContext[F[_]](
    security: EndpointSecurity[F],
    execution: EndpointExecution[F],
)
