package momo.api.http

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import io.circe.parser.decode as circeDecode
import io.circe.syntax.*
import io.circe.{Decoder, Encoder, Json, Printer}

import momo.api.auth.AuthenticatedMember
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError
import momo.api.repositories.{IdempotencyRecord, IdempotencyRepository, IdempotencyResponse}

/**
 * Wraps a mutation effect with persistent idempotency replay semantics.
 *
 * For details see `apps/api/docs/proposals/idempotency-keys.md`.
 *
 *   - When `Idempotency-Key` is absent, the wrapped effect runs unchanged.
 *   - When present and the `(key, memberId, endpoint)` row already exists with the same request
 *     hash, the stored response body is decoded and replayed without invoking the effect.
 *   - Same key with a different request hash returns HTTP 409 Conflict.
 *   - Otherwise the effect runs and the success response is recorded with a 24h TTL.
 */
private[http] object IdempotencyHandler:
  private val PrinterCanonical: Printer =
    Printer(dropNullValues = false, indent = "", sortKeys = true)
  private val RetentionMillis: Long = 24L * 60L * 60L * 1000L

  /**
   * @param key       the inbound `Idempotency-Key` header value
   * @param member    authenticated caller (PK component)
   * @param endpoint  endpoint label, e.g. "POST /api/match-drafts"
   * @param request   request payload used to compute the canonical hash
   * @param now       effectful clock
   * @param run       effect that performs the mutation; only invoked on Fresh
   */
  def wrap[F[_]: Async, Req, Resp](
      idempotency: IdempotencyRepository[F],
      key: Option[String],
      member: AuthenticatedMember,
      endpoint: String,
      request: Req,
      now: F[Instant],
      run: F[Either[ProblemDetails.ProblemResponse, Resp]],
  )(
      using Encoder[Req],
      Encoder[Resp],
      Decoder[Resp],
  ): F[Either[ProblemDetails.ProblemResponse, Resp]] = key.map(_.trim).filter(_.nonEmpty) match
    case None => run
    case Some(rawKey) =>
      val requestHash = sha256(canonicalJsonBytes(request.asJson))
      idempotency.lookup(rawKey, member.memberId, endpoint).flatMap {
        case Some(existing) if existing.requestHash == requestHash =>
          decodeStoredBody[Resp](existing.response.body) match
            case Right(replay) => Async[F].pure(Right(replay))
            case Left(_) => run.flatMap(
                handleFreshResult(idempotency, rawKey, member, endpoint, requestHash, now, _)
              )
        case Some(_) => Async[F].pure(Left(ProblemDetails.from(
            AppError.Conflict("Idempotency-Key was reused with a different request payload.")
          )))
        case None => run
            .flatMap(handleFreshResult(idempotency, rawKey, member, endpoint, requestHash, now, _))
      }

  private def handleFreshResult[F[_]: Async, Resp: Encoder](
      idempotency: IdempotencyRepository[F],
      key: String,
      member: AuthenticatedMember,
      endpoint: String,
      requestHash: Vector[Byte],
      now: F[Instant],
      result: Either[ProblemDetails.ProblemResponse, Resp],
  ): F[Either[ProblemDetails.ProblemResponse, Resp]] = result match
    case left @ Left(_) => Async[F].pure(left)
    case right @ Right(value) => now.flatMap { ts =>
        val response = IdempotencyResponse(
          status = 200,
          headers = Map.empty,
          body = canonicalJsonBytes(value.asJson).toVector,
        )
        val record = IdempotencyRecord(
          key = key,
          memberId = member.memberId,
          endpoint = endpoint,
          requestHash = requestHash,
          response = response,
          createdAt = ts,
          expiresAt = ts.plusMillis(RetentionMillis),
        )
        idempotency.record(record).attempt.as(right)
      }

  private def canonicalJsonBytes(json: Json): Array[Byte] = PrinterCanonical.print(json)
    .getBytes(StandardCharsets.UTF_8)

  private def sha256(bytes: Array[Byte]): Vector[Byte] = MessageDigest.getInstance("SHA-256")
    .digest(bytes).toVector

  private def decodeStoredBody[A: Decoder](bytes: Vector[Byte]): Either[Throwable, A] =
    circeDecode[A](new String(bytes.toArray, StandardCharsets.UTF_8))
end IdempotencyHandler
