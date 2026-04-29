package momo.api.endpoints

import momo.api.http.ProblemDetails
import momo.api.http.ProblemDetails.ErrorInfo
import sttp.tapir.EndpointOutput
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.statusCode

object CommonEndpoint:
  val errorOut: EndpointOutput[ErrorInfo] =
    statusCode.and(jsonBody[ProblemDetails])
