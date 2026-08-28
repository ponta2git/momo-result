package momo.api.endpoints

import sttp.tapir.*

object ExportEndpoints:
  final case class MatchExportInput(
      format: String,
      seasonMasterId: Option[String],
      heldEventId: Option[String],
      matchId: Option[String],
  )

  final case class MatchExportOutput(
      contentDisposition: String,
      contentType: String,
      body: String,
  )

  private val matchExportInput: EndpointInput[MatchExportInput] = query[String]("format")
    .and(query[Option[String]]("seasonMasterId"))
    .and(query[Option[String]]("heldEventId"))
    .and(query[Option[String]]("matchId"))
    .mapTo[MatchExportInput]

  private val matchExportOutput: EndpointOutput[MatchExportOutput] = header[String](
    "Content-Disposition"
  ).and(header[String]("Content-Type")).and(stringBody).mapTo[MatchExportOutput]

  val matches: CommonEndpoint.SecuredRead[MatchExportInput, MatchExportOutput] = endpoint
    .get
    .in("api" / "exports" / "matches")
    .securityIn(CommonEndpoint.accountHeader)
    .in(matchExportInput)
    .errorOut(CommonEndpoint.errorOut)
    .out(matchExportOutput)
    .tag("exports")
