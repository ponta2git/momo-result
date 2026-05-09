package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object AdminAccountEndpoints:
  val list: PublicEndpoint[Option[String], ProblemResponse, LoginAccountListResponse, Any] =
    endpoint
      .get
      .in("api" / "admin" / "login-accounts")
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(jsonBody[LoginAccountListResponse])
      .tag("admin")

  val create: PublicEndpoint[
    (Option[String], Option[String], Option[String], CreateLoginAccountRequest),
    ProblemResponse,
    LoginAccountResponse,
    Any,
  ] = endpoint
    .post
    .in("api" / "admin" / "login-accounts")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateLoginAccountRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[LoginAccountResponse])
    .tag("admin")

  val update: PublicEndpoint[
    (String, Option[String], Option[String], UpdateLoginAccountRequest),
    ProblemResponse,
    LoginAccountResponse,
    Any,
  ] = endpoint
    .patch
    .in("api" / "admin" / "login-accounts" / path[String]("accountId"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(jsonBody[UpdateLoginAccountRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[LoginAccountResponse])
    .tag("admin")
