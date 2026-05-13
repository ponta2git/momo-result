package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{header, statusCode, EndpointInput, EndpointOutput}

import momo.api.auth.AuthHeaderNames
import momo.api.endpoints.ProblemDetails.ProblemResponse

/**
 * Building blocks shared across every Tapir endpoint definition.
 *
 * The named header inputs centralize the wire-level header names used by the auth and
 * idempotency middleware so endpoint files don't repeat the strings. The semantics — authenticated
 * account dispatch on `X-Momo-Account-Id`, CSRF on `X-CSRF-Token`, idempotent replay on
 * `Idempotency-Key` —
 * are documented in `apps/api/docs/proposals/idempotency-keys.md` and `architecture.md`.
 */
object CommonEndpoint:
  val errorOut: EndpointOutput[ProblemResponse] = statusCode.and(jsonBody[ProblemDetails])

  /**
   * The session-derived account id header. In Prod, middleware injects it after validating the
   * session cookie; in Dev/Test, local tooling may supply it directly.
   */
  val accountHeader: EndpointInput[Option[String]] =
    header[Option[String]](AuthHeaderNames.AccountId)

  /** CSRF token sent on every state-changing request alongside the session cookie. */
  val csrfHeader: EndpointInput[Option[String]] = header[Option[String]]("X-CSRF-Token")

  /**
   * Per-request `Idempotency-Key` header used by mutation endpoints to deduplicate retries.
   * Absent value means "pass through, don't dedupe"; non-empty means "store/replay".
   */
  val idempotencyKeyHeader: EndpointInput[Option[String]] =
    header[Option[String]]("Idempotency-Key")
end CommonEndpoint
