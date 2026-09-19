package momo.api.contracts.seriesanalysis

import java.nio.charset.StandardCharsets

import io.circe.Json
import io.circe.parser.parse

import momo.api.domain.SeriesAnalysisChunkKind

/** The single artifact contract this API can read and advertise. */
private[api] object SeriesAnalysisArtifactContract:
  private val ResourcePath =
    "/momo/api/series-analysis-schemas/series-analysis-publication-contract-v2.json"
  private val Contract = loadContract()

  val ArtifactSchemaVersion: Int = Contract.hcursor.get[Int]("artifactSchemaVersion")
    .fold(error => sys.error(s"Invalid artifact schema version: $error"), identity)
  val ValidationContractId: String = Contract.hcursor.get[String]("validationContractId")
    .fold(error => sys.error(s"Invalid validation contract ID: $error"), identity)

  locally:
    val fields = Set("$comment", "artifactSchemaVersion", "contractVersion", "validationContractId")
    if !Contract.asObject.exists(_.keys.toSet == fields) ||
      !Contract.hcursor.get[Int]("contractVersion").contains(2) || ArtifactSchemaVersion != 4 ||
      !ValidationContractId.matches("^[a-z0-9][a-z0-9._-]{0,127}$")
    then sys.error("Unsupported Series analysis publication contract")

  val OwnerSchemaFiles: Map[SeriesAnalysisChunkKind, String] = Map(
    SeriesAnalysisChunkKind.Aggregate -> "series-analysis-aggregate-v5.schema.json",
    SeriesAnalysisChunkKind.Review -> "series-analysis-review-v4.schema.json",
    SeriesAnalysisChunkKind.Drilldown -> "series-analysis-drilldown-v3.schema.json",
    SeriesAnalysisChunkKind.MatchContext -> "series-analysis-match-context-v1.schema.json",
  )

  def supports(schemaVersion: Int, validationContractId: Option[String]): Boolean =
    schemaVersion == ArtifactSchemaVersion && validationContractId.contains(ValidationContractId)

  private def loadContract(): Json =
    val stream = Option(getClass.getResourceAsStream(ResourcePath)).getOrElse(
      sys.error(s"Series analysis publication contract is missing: $ResourcePath")
    )
    try
      parse(new String(stream.readAllBytes(), StandardCharsets.UTF_8)).fold(
        error => sys.error(s"Invalid Series analysis publication contract: $error"),
        identity,
      )
    finally stream.close()
