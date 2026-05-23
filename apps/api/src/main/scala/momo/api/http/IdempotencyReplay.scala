package momo.api.http

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import io.circe.parser.decode as circeDecode
import io.circe.syntax.*
import io.circe.{Decoder, Encoder, Json, Printer}
import org.slf4j.LoggerFactory

import momo.api.auth.{AuthenticatedAccount, RateLimiter}
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.{
  IdempotencyRecord, IdempotencyRepository, IdempotencyReservation, IdempotencyResponse,
}

/**
 * Wraps a mutation effect with persistent idempotency replay semantics.
 *
 * For details see `apps/api/docs/proposals/idempotency-keys.md`.
 *
 *   - When `Idempotency-Key` is absent, the wrapped effect runs unchanged.
 *   - When present and the `(key, accountId, endpoint)` row already exists with the same request
 *     hash, the stored response body is decoded and replayed without invoking the effect.
 *   - Same key with a different request hash returns HTTP 409 Conflict.
 *   - Otherwise the effect runs and the success response is recorded with a 24h TTL.
 */
private[http] object IdempotencyReplay:
  private val logger = LoggerFactory.getLogger("momo.api.http.IdempotencyReplay")
  private val PrinterCanonical: Printer =
    Printer(dropNullValues = false, indent = "", sortKeys = true)
  private val RetentionMillis: Long = 24L * 60L * 60L * 1000L
  private val ValidKeyPattern = "^[A-Za-z0-9._:-]{1,128}$".r

  final case class Guard[F[_]](
      repository: IdempotencyRepository[F],
      mutationRateLimiter: RateLimiter[F],
      activeKeyLimitPerAccount: Int,
  )

  /**
   * @param key       the inbound `Idempotency-Key` header value
   * @param account   authenticated caller (PK component)
   * @param endpoint  endpoint label, e.g. "POST /api/match-drafts"
   * @param request   request payload used to compute the canonical hash
   * @param now       effectful clock
   * @param run       effect that performs the mutation; only invoked on Fresh
   */
  def wrap[F[_]: Async, Req, Resp](
      guard: Guard[F],
      key: Option[String],
      account: AuthenticatedAccount,
      endpoint: String,
      request: Req,
      now: F[Instant],
      run: F[Either[ProblemDetails.ProblemResponse, Resp]],
  )(
      using Encoder[Req],
      Encoder[Resp],
      Decoder[Resp],
  ): F[Either[ProblemDetails.ProblemResponse, Resp]] = key match
    case None => enforceMutationRateLimit[F, Resp](guard, endpoint, account, keyPresent = false)
        .flatMap {
          case Some(problem) => Async[F].pure(Left(problem))
          case None => run
        }
    case Some(rawKey) if !isValidKey(rawKey) =>
      Async[F].pure(Left(ProblemDetails.from(AppError.ValidationFailed(
        "Idempotency-Key must be 1 to 128 characters using only A-Z, a-z, 0-9, dot, underscore, colon, or hyphen."
      ))))
    case Some(rawKey) =>
      val requestHash = sha256(canonicalJsonBytes(request.asJson))
      now.flatMap { ts =>
        val pending = IdempotencyRecord(
          key = rawKey,
          accountId = account.accountId,
          endpoint = endpoint,
          requestHash = requestHash,
          response = IdempotencyResponse(status = 0, headers = Map.empty, body = Vector.empty),
          createdAt = ts,
          expiresAt = ts.plusMillis(RetentionMillis),
        )
        guard.repository.lookup(rawKey, account.accountId, endpoint).flatMap {
          case Some(existing) =>
            handleReservation(guard, rawKey, account, endpoint, requestHash, run)(
              reservationForExisting(existing, requestHash)
            )
          case None =>
            enforceMutationRateLimit[F, Resp](guard, endpoint, account, keyPresent = true).flatMap {
              case Some(problem) => Async[F].pure(Left(problem))
              case None => guard.repository
                  .reserveWithinAccountLimit(pending, ts, guard.activeKeyLimitPerAccount)
                  .flatMap(handleReservation(guard, rawKey, account, endpoint, requestHash, run))
            }
        }
      }

  private def handleReservation[F[_]: Async, Resp: Encoder: Decoder](
      guard: Guard[F],
      key: String,
      account: AuthenticatedAccount,
      endpoint: String,
      requestHash: Vector[Byte],
      run: F[Either[ProblemDetails.ProblemResponse, Resp]],
  )(reservation: IdempotencyReservation): F[Either[ProblemDetails.ProblemResponse, Resp]] =
    reservation match
      case IdempotencyReservation.Reserved => run.attempt.flatMap {
          case Right(result) =>
            handleFreshResult(guard.repository, key, account, endpoint, requestHash, result)
          case Left(error) =>
            logIdempotencyFailure(endpoint, account, key, "run mutation", error) >>
              abandonReservation(guard.repository, key, account, endpoint, requestHash) >>
              Async[F].raiseError(error)
        }
      case IdempotencyReservation.Replay(response) =>
        replayStoredBody[F, Resp](endpoint, account, key, response)
      case IdempotencyReservation.InProgress => Async[F].pure(Left(ProblemDetails.from(
          AppError.IdempotencyInProgress("Idempotency-Key is already processing. Retry later.")
        )))
      case IdempotencyReservation.Conflict => Async[F]
          .pure(Left(ProblemDetails.from(AppError.IdempotencyPayloadMismatch(
            "Idempotency-Key was reused with a different request payload."
          ))))
      case IdempotencyReservation.AccountLimitExceeded =>
        logAccountLimitExceeded(endpoint, account, guard.activeKeyLimitPerAccount) >>
          Async[F].pure(Left(ProblemDetails.from(AppError.TooManyRequests(
            "Too many active Idempotency-Key values. Retry later or reuse the key for the same operation."
          ))))

  private def reservationForExisting(
      existing: IdempotencyRecord,
      requestHash: Vector[Byte],
  ): IdempotencyReservation =
    if existing.requestHash != requestHash then IdempotencyReservation.Conflict
    else if existing.response.status == 0 then IdempotencyReservation.InProgress
    else IdempotencyReservation.Replay(existing.response)

  private def enforceMutationRateLimit[F[_]: Async, A](
      guard: Guard[F],
      endpoint: String,
      account: AuthenticatedAccount,
      keyPresent: Boolean,
  ): F[Option[ProblemDetails.ProblemResponse]] = guard.mutationRateLimiter
    .allow(s"mutation:${account.accountId.value}").flatMap {
      case true => Async[F].pure(None)
      case false => logMutationRateLimited(endpoint, account, keyPresent) >> Async[F].pure(Some(
          ProblemDetails
            .from(AppError.TooManyRequests("Too many mutation requests. Try again later."))
        ))
    }

  private def abandonReservation[F[_]: Async](
      idempotency: IdempotencyRepository[F],
      key: String,
      account: AuthenticatedAccount,
      endpoint: String,
      requestHash: Vector[Byte],
  ): F[Unit] = idempotency.abandon(key, account.accountId, endpoint, requestHash).attempt.flatMap {
    case Right(_) => Async[F].unit
    case Left(error) => logIdempotencyFailure(endpoint, account, key, "abandon", error)
  }

  private def handleFreshResult[F[_]: Async, Resp: Encoder](
      idempotency: IdempotencyRepository[F],
      key: String,
      account: AuthenticatedAccount,
      endpoint: String,
      requestHash: Vector[Byte],
      result: Either[ProblemDetails.ProblemResponse, Resp],
  ): F[Either[ProblemDetails.ProblemResponse, Resp]] = result match
    case left @ Left(_) => abandonReservation(idempotency, key, account, endpoint, requestHash)
        .as(left)
    case right @ Right(value) =>
      val response = IdempotencyResponse(
        status = 200,
        headers = Map.empty,
        body = canonicalJsonBytes(value.asJson).toVector,
      )
      idempotency.complete(key, account.accountId, endpoint, requestHash, response).attempt
        .flatMap {
          case Right(_) => Async[F].pure(right)
          case Left(error) => logIdempotencyFailure(endpoint, account, key, "complete", error)
              .as(right)
        }

  private def canonicalJsonBytes(json: Json): Array[Byte] = PrinterCanonical.print(json)
    .getBytes(StandardCharsets.UTF_8)

  private def sha256(bytes: Array[Byte]): Vector[Byte] = MessageDigest.getInstance("SHA-256")
    .digest(bytes).toVector

  private def isValidKey(value: String): Boolean = ValidKeyPattern.matches(value)

  private def decodeStoredBody[A: Decoder](bytes: Vector[Byte]): Either[Throwable, A] =
    circeDecode[A](new String(bytes.toArray, StandardCharsets.UTF_8))

  private def replayStoredBody[F[_]: Async, A: Decoder](
      endpoint: String,
      account: AuthenticatedAccount,
      key: String,
      response: IdempotencyResponse,
  ): F[Either[ProblemDetails.ProblemResponse, A]] = decodeStoredBody[A](response.body) match
    case Right(replay) => Async[F].pure(Right(replay))
    case Left(error) => logIdempotencyFailure(endpoint, account, key, "decode stored", error) >>
        Async[F].pure(Left(
          ProblemDetails
            .from(AppError.Internal("Stored idempotency response could not be decoded."))
        ))

  private def logIdempotencyFailure[F[_]: Async](
      endpoint: String,
      account: AuthenticatedAccount,
      key: String,
      operation: String,
      error: Throwable,
  ): F[Unit] = Async[F].delay {
    val classes = SafeLog.throwableClasses(error)
    logger.error(s"Failed to $operation idempotency response endpoint=$endpoint accountId=${account
        .accountId.value} keyLength=${key.length} errorClasses=$classes")
  }

  private def logMutationRateLimited[F[_]: Async](
      endpoint: String,
      account: AuthenticatedAccount,
      keyPresent: Boolean,
  ): F[Unit] = Async[F].delay {
    logger.warn(s"idempotency_mutation_rate_limited endpoint=$endpoint accountId=${account.accountId
        .value} keyPresent=${keyPresent.toString}")
  }

  private def logAccountLimitExceeded[F[_]: Async](
      endpoint: String,
      account: AuthenticatedAccount,
      limit: Int,
  ): F[Unit] = Async[F].delay {
    logger
      .warn(s"idempotency_active_key_limit_exceeded endpoint=$endpoint accountId=${account.accountId
          .value} limit=${limit.toString}")
  }
end IdempotencyReplay
