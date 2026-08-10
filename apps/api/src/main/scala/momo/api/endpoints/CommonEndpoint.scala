package momo.api.endpoints

import sttp.tapir.json.circe.*
import sttp.tapir.model.ServerRequest
import sttp.tapir.{extractFromRequest, header, statusCode, Endpoint, EndpointInput, EndpointOutput}

import momo.api.auth.AuthHeaderNames
import momo.api.endpoints.ProblemDetails.ProblemResponse

/**
 * Building blocks shared across every Tapir endpoint definition.
 *
 * The named header inputs centralize the wire-level header names used by the auth and
 * idempotency middleware so endpoint files don't repeat the strings. The semantics —
 * authenticated account dispatch, CSRF, and idempotent replay — follow the API architecture and
 * database contract in the repository-level `docs/` directory.
 */
object CommonEndpoint:
  type SecuredRead[I, O] = Endpoint[Option[String], I, ProblemResponse, O, Any]
  type SecuredMutation[I, O] =
    Endpoint[(Option[String], Option[String]), I, ProblemResponse, O, Any]

  val errorOut: EndpointOutput[ProblemResponse] = statusCode
    .and(header[Option[String]]("Retry-After"))
    .and(jsonBody[ProblemDetails])

  /**
   * Dev/Test account shortcut header. Production ignores externally supplied account ids and
   * authenticates the session cookie through the server-side request context.
   */
  val accountHeader: EndpointInput[Option[String]] =
    header[Option[String]](AuthHeaderNames.AccountId)

  /** CSRF token sent on every state-changing request alongside the session cookie. */
  val csrfHeader: EndpointInput[Option[String]] = header[Option[String]](AuthHeaderNames.CsrfToken)

  /** Server-side request context used by auth policies; it is not part of the public wire schema. */
  val serverRequest: EndpointInput[ServerRequest] = extractFromRequest(identity[ServerRequest])

  /** Correlation id validated or minted by [[momo.api.http.RequestIdMiddleware]]. */
  val requestIdHeader: EndpointInput[Option[String]] =
    header[Option[String]](AuthHeaderNames.RequestId)

  /**
   * Per-request `Idempotency-Key` header used by mutation endpoints to deduplicate retries.
   * Absent value means "pass through, don't dedupe"; non-empty means "store/replay".
   */
  val idempotencyKeyHeader: EndpointInput[Option[String]] =
    header[Option[String]](AuthHeaderNames.IdempotencyKey)
end CommonEndpoint
