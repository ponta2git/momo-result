package momo.api.endpoints

import fs2.Stream
import sttp.capabilities.fs2.Fs2Streams
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

  type SourceImageStreamOutput[F[_]] = (String, String, String, Stream[F, Byte])

  def getSourceImageStream[F[_]]
      : Endpoint[
        Option[String],
        (String, String, Option[String]),
        ProblemDetails.ProblemResponse,
        SourceImageStreamOutput[F],
        Fs2Streams[F]
      ] =
    endpoint
      .get
      .in("api" / "match-drafts" / path[String]("draftId") / "source-images" / path[String]("kind"))
      .securityIn(CommonEndpoint.accountHeader)
      .in(CommonEndpoint.requestIdHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(header[String]("Content-Type"))
      .out(header[String]("Cache-Control"))
      .out(header[String]("X-Content-Type-Options"))
      .out(streamBinaryBody(Fs2Streams[F])(CodecFormat.OctetStream()))
      .tag("match-drafts")

  type SourceImageArchiveStreamOutput[F[_]] = (String, String, String, String, Stream[F, Byte])

  def downloadSourceImagesStream[F[_]]
      : Endpoint[
        Option[String],
        (String, Option[String]),
        ProblemDetails.ProblemResponse,
        SourceImageArchiveStreamOutput[F],
        Fs2Streams[F]
      ] =
    endpoint
      .get
      .in("api" / "match-drafts" / path[String]("draftId") / "source-images.zip")
      .securityIn(CommonEndpoint.accountHeader)
      .in(CommonEndpoint.requestIdHeader)
      .errorOut(CommonEndpoint.errorOut)
      .out(header[String]("Content-Type"))
      .out(header[String]("Content-Disposition"))
      .out(header[String]("Cache-Control"))
      .out(header[String]("X-Content-Type-Options"))
      .out(streamBinaryBody(Fs2Streams[F])(CodecFormat.Zip()))
      .tag("match-drafts")
