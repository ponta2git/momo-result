package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{header, statusCode, EndpointInput, EndpointOutput}

import momo.api.http.ProblemDetails
import momo.api.http.ProblemDetails.ErrorInfo

/**
 * Building blocks shared across every Tapir endpoint definition.
 *
 * The named header inputs centralize the wire-level header names used by the auth and
 * idempotency middleware so endpoint files don't repeat the strings. The semantics — Dev/Prod
 * dispatch on `X-Dev-User`, CSRF on `X-CSRF-Token`, idempotent replay on `Idempotency-Key` —
 * are documented in `apps/api/docs/proposals/idempotency-keys.md` and `architecture.md`.
 */
object CommonEndpoint:
  val errorOut: EndpointOutput[ErrorInfo] = statusCode.and(jsonBody[ProblemDetails])

  /**
   * The session-derived `X-Dev-User` header. In Prod, [[ProductionSessionMiddleware]] injects it
   * after validating the session cookie; in Dev, [[DevAuthMiddleware]] passes the client-supplied
   * value through. Endpoints should always read it as `Option[String]` and never trust an
   * unverified client value.
   */
  val devUserHeader: EndpointInput[Option[String]] = header[Option[String]]("X-Dev-User")

  /** CSRF token sent on every state-changing request alongside the session cookie. */
  val csrfHeader: EndpointInput[Option[String]] = header[Option[String]]("X-CSRF-Token")

  /**
   * Per-request `Idempotency-Key` header used by mutation endpoints to deduplicate retries.
   * Absent value means "pass through, don't dedupe"; non-empty means "store/replay".
   */
  val idempotencyKeyHeader: EndpointInput[Option[String]] =
    header[Option[String]]("Idempotency-Key")
end CommonEndpoint
