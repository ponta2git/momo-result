package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object MatchDraftEndpoints:
  type CreateInput = (Option[String], CreateMatchDraftRequest)
  type GetInput = String
  type UpdateInput = (String, Option[String], UpdateMatchDraftRequest)
  type CancelInput = (String, Option[String])

  val create: CommonEndpoint.SecuredMutation[CreateInput, MatchDraftResponse] = endpoint
    .post
    .in("api" / "match-drafts")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateMatchDraftRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftResponse])
    .tag("match-drafts")

  val update: CommonEndpoint.SecuredMutation[UpdateInput, MatchDraftResponse] = endpoint
    .patch
    .in("api" / "match-drafts" / path[String]("draftId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateMatchDraftRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftResponse])
    .tag("match-drafts")

  val get: CommonEndpoint.SecuredRead[GetInput, MatchDraftDetailResponse] = endpoint
    .get
    .in("api" / "match-drafts" / path[String]("draftId"))
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftDetailResponse])
    .tag("match-drafts")

  val cancel: CommonEndpoint.SecuredMutation[CancelInput, CancelMatchDraftResponse] = endpoint
    .post
    .in("api" / "match-drafts" / path[String]("draftId") / "cancel")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CancelMatchDraftResponse])
    .tag("match-drafts")

  val listSourceImages: CommonEndpoint.SecuredRead[
    String,
    MatchDraftSourceImageListResponse,
  ] = endpoint
    .get
    .in("api" / "match-drafts" / path[String]("draftId") / "source-images")
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftSourceImageListResponse])
    .tag("match-drafts")

  type SourceImageOutput = (String, String, String, Array[Byte])

  val getSourceImage
      : CommonEndpoint.SecuredRead[(String, String), SourceImageOutput] =
    endpoint
      .get
      .in("api" / "match-drafts" / path[String]("draftId") / "source-images" / path[String]("kind"))
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(header[String]("Content-Type"))
      .out(header[String]("Cache-Control"))
      .out(header[String]("X-Content-Type-Options"))
      .out(byteArrayBody)
      .tag("match-drafts")

  type SourceImageArchiveOutput = (String, String, String, String, Array[Byte])

  val downloadSourceImages
      : CommonEndpoint.SecuredRead[String, SourceImageArchiveOutput] =
    endpoint
      .get
      .in("api" / "match-drafts" / path[String]("draftId") / "source-images.zip")
      .securityIn(CommonEndpoint.accountHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(header[String]("Content-Type"))
      .out(header[String]("Content-Disposition"))
      .out(header[String]("Cache-Control"))
      .out(header[String]("X-Content-Type-Options"))
      .out(byteArrayBody)
      .tag("match-drafts")
