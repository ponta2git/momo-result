package momo.api.endpoints

import sttp.model.Part
import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

object UploadEndpoints:
  type UploadInput = Seq[Part[Array[Byte]]]

  val uploadImage: CommonEndpoint.SecuredMutation[UploadInput, UploadImageResponse] = endpoint
    .post
    .in(UploadPaths.Api / UploadPaths.Uploads / UploadPaths.Images)
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(multipartBody)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[UploadImageResponse])
    .tag("uploads")
