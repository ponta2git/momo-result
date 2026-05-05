package momo.api.endpoints

import sttp.tapir.{PublicEndpoint, *}

import momo.api.endpoints.ProblemDetails.ProblemResponse

object ExportEndpoints:
  type MatchExportInput = (String, Option[String], Option[String], Option[String], Option[String])

  type MatchExportOutput = (String, String, String)

  val matches: PublicEndpoint[MatchExportInput, ProblemResponse, MatchExportOutput, Any] = endpoint
    .get
    .in("api" / "exports" / "matches")
    .in(query[String]("format"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("heldEventId"))
    .in(query[Option[String]]("matchId"))
    .in(CommonEndpoint.devUserHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(header[String]("Content-Disposition"))
    .out(header[String]("Content-Type"))
    .out(stringBody)
    .tag("exports")
