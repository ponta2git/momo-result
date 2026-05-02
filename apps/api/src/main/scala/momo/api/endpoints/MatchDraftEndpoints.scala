package momo.api.endpoints

import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.{PublicEndpoint, *}
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object MatchDraftEndpoints:
  type CreateInput = (Option[String], Option[String], CreateMatchDraftRequest)
  type UpdateInput = (String, Option[String], Option[String], UpdateMatchDraftRequest)
  type CancelInput = (String, Option[String], Option[String])

  val create: PublicEndpoint[CreateInput, ErrorInfo, MatchDraftResponse, Any] = endpoint
    .post
    .in("api" / "match-drafts")
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
    .in(jsonBody[CreateMatchDraftRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftResponse])
    .tag("match-drafts")

  val update: PublicEndpoint[UpdateInput, ErrorInfo, MatchDraftResponse, Any] = endpoint
    .patch
    .in("api" / "match-drafts" / path[String]("draftId"))
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
    .in(jsonBody[UpdateMatchDraftRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftResponse])
    .tag("match-drafts")

  val cancel: PublicEndpoint[CancelInput, ErrorInfo, CancelMatchDraftResponse, Any] = endpoint
    .post
    .in("api" / "match-drafts" / path[String]("draftId") / "cancel")
    .in(header[Option[String]]("X-Dev-User"))
    .in(header[Option[String]]("X-CSRF-Token"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[CancelMatchDraftResponse])
    .tag("match-drafts")

  val listSourceImages: PublicEndpoint[
    (String, Option[String]),
    ErrorInfo,
    MatchDraftSourceImageListResponse,
    Any,
  ] = endpoint
    .get
    .in("api" / "match-drafts" / path[String]("draftId") / "source-images")
    .in(header[Option[String]]("X-Dev-User"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[MatchDraftSourceImageListResponse])
    .tag("match-drafts")

  type SourceImageOutput = (String, String, Array[Byte])

  val getSourceImage
      : PublicEndpoint[(String, String, Option[String]), ErrorInfo, SourceImageOutput, Any] =
    endpoint
      .get
      .in("api" / "match-drafts" / path[String]("draftId") / "source-images" / path[String]("kind"))
      .in(header[Option[String]]("X-Dev-User"))
      .errorOut(CommonEndpoint.errorOut)
      .out(header[String]("Cache-Control"))
      .out(header[String]("X-Content-Type-Options"))
      .out(byteArrayBody)
      .tag("match-drafts")
