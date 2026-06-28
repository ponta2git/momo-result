package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object AdminAccountEndpoints:
  val list: CommonEndpoint.SecuredRead[Unit, LoginAccountListResponse] =
    endpoint
      .get
      .in("api" / "admin" / "login-accounts")
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[LoginAccountListResponse])
      .tag("admin")

  val create: CommonEndpoint.SecuredMutation[
    (Option[String], CreateLoginAccountRequest),
    LoginAccountResponse,
  ] = endpoint
    .post
    .in("api" / "admin" / "login-accounts")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateLoginAccountRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[LoginAccountResponse])
    .tag("admin")

  val update: CommonEndpoint.SecuredMutation[
    (String, Option[String], UpdateLoginAccountRequest),
    LoginAccountResponse,
  ] = endpoint
    .patch
    .in("api" / "admin" / "login-accounts" / path[String]("accountId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateLoginAccountRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[LoginAccountResponse])
    .tag("admin")
