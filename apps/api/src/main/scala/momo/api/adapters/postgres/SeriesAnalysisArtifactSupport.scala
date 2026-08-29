package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets

import io.circe.Json
import io.circe.parser.parse

private[api] object SeriesAnalysisArtifactSupport:
  private val ContractResource =
    "/momo/api/series-analysis-schemas/series-analysis-publication-contract-v1.json"
  private val Contract = loadContract()

  val ValidationContractId: String = Contract.hcursor.get[String]("validationContractId")
    .fold(error => sys.error(s"Invalid validation contract ID: $error"), identity)
  val ArtifactSchemaVersion: Int = Contract.hcursor.get[Int]("artifactSchemaVersion")
    .fold(error => sys.error(s"Invalid artifact schema version: $error"), identity)
  val SupportedArtifactSchemas: Set[Int] = Set(ArtifactSchemaVersion)
  val SupportedValidationContractIds: Set[String] = Set(ValidationContractId)

  locally:
    val contractVersion = Contract.hcursor.get[Int]("contractVersion")
      .fold(error => sys.error(s"Invalid publication contract version: $error"), identity)
    val exactFields = Set(
      "$comment",
      "artifactSchemaVersion",
      "contractVersion",
      "validationContractId",
    )
    if contractVersion != 1 || ArtifactSchemaVersion < 1 ||
      !ValidationContractId.matches("^[a-z0-9][a-z0-9._-]{0,127}$") ||
      !Contract.asObject.exists(_.keys.toSet == exactFields)
    then sys.error("Unsupported Series analysis publication contract")

  def supports(schemaVersion: Int, validationContractId: Option[String]): Boolean =
    schemaVersion == ArtifactSchemaVersion && validationContractId.contains(ValidationContractId)

  private def loadContract(): Json =
    val stream = Option(getClass.getResourceAsStream(ContractResource)).getOrElse(
      sys.error(s"Series analysis publication contract is missing: $ContractResource")
    )
    try
      parse(new String(stream.readAllBytes(), StandardCharsets.UTF_8))
        .fold(
          error => sys.error(s"Invalid Series analysis publication contract: $error"),
          identity,
        )
    finally stream.close()
