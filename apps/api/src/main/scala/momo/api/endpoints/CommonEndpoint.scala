package momo.api.endpoints

import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*
import sttp.tapir.{statusCode, EndpointOutput}

import momo.api.http.ProblemDetails
import momo.api.http.ProblemDetails.ErrorInfo

object CommonEndpoint:
  val errorOut: EndpointOutput[ErrorInfo] = statusCode.and(jsonBody[ProblemDetails])
