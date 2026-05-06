package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object MatchDraftEndpoints:
  type CreateInput = (Option[String], Option[String], Option[String], CreateMatchDraftRequest)
  type GetInput = (String, Option[String])
  type UpdateInput =
    (String, Option[String], Option[String], Option[String], UpdateMatchDraftRequest)
  type CancelInput = (String, Option[String], Option[String])

  val create: PublicEndpoint[CreateInput, ProblemResponse, MatchDraftResponse, Any] = endpoint
    .post
    .in("api" / "match-drafts")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateMatchDraftRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftResponse])
    .tag("match-drafts")

  val update: PublicEndpoint[UpdateInput, ProblemResponse, MatchDraftResponse, Any] = endpoint
    .patch
    .in("api" / "match-drafts" / path[String]("draftId"))
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateMatchDraftRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftResponse])
    .tag("match-drafts")

  val get: PublicEndpoint[GetInput, ProblemResponse, MatchDraftDetailResponse, Any] = endpoint
    .get
    .in("api" / "match-drafts" / path[String]("draftId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftDetailResponse])
    .tag("match-drafts")

  val cancel: PublicEndpoint[CancelInput, ProblemResponse, CancelMatchDraftResponse, Any] = endpoint
    .post
    .in("api" / "match-drafts" / path[String]("draftId") / "cancel")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CancelMatchDraftResponse])
    .tag("match-drafts")

  val listSourceImages: PublicEndpoint[
    (String, Option[String]),
    ProblemResponse,
    MatchDraftSourceImageListResponse,
    Any,
  ] = endpoint
    .get
    .in("api" / "match-drafts" / path[String]("draftId") / "source-images")
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftSourceImageListResponse])
    .tag("match-drafts")

  type SourceImageOutput = (String, String, String, Array[Byte])

  val getSourceImage
      : PublicEndpoint[(String, String, Option[String]), ProblemResponse, SourceImageOutput, Any] =
    endpoint
      .get
      .in("api" / "match-drafts" / path[String]("draftId") / "source-images" / path[String]("kind"))
      .in(CommonEndpoint.devUserHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(header[String]("Content-Type"))
      .out(header[String]("Cache-Control"))
      .out(header[String]("X-Content-Type-Options"))
      .out(byteArrayBody)
      .tag("match-drafts")
