package momo.api.endpoints

import sttp.tapir.*

object ExportEndpoints:
  type MatchExportInput = (String, Option[String], Option[String], Option[String])

  type MatchExportOutput = (String, String, String)

  val matches: CommonEndpoint.SecuredRead[MatchExportInput, MatchExportOutput] = endpoint
    .get
    .in("api" / "exports" / "matches")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[String]("format"))
    .in(query[Option[String]]("seasonMasterId"))
    .in(query[Option[String]]("heldEventId"))
    .in(query[Option[String]]("matchId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(header[String]("Content-Disposition"))
    .out(header[String]("Content-Type"))
    .out(stringBody)
    .tag("exports")
