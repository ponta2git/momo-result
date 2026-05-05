package momo.api.endpoints

import sttp.model.Part
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{PublicEndpoint, *}

import momo.api.http.ProblemDetails.ErrorInfo

object UploadEndpoints:
  type UploadInput = (Option[String], Option[String], Seq[Part[Array[Byte]]])

  val uploadImage: PublicEndpoint[UploadInput, ErrorInfo, UploadImageResponse, Any] = endpoint
    .post
    .in("api" / "uploads" / "images")
    .in(CommonEndpoint.devUserHeader)
    .in(CommonEndpoint.csrfHeader)
    .in(multipartBody)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[UploadImageResponse])
    .tag("uploads")
