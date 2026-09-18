package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets

import io.circe.Json
import io.circe.parser.parse

private[api] object SeriesAnalysisArtifactSupport:
  private val ContractResource =
    "/momo/api/series-analysis-schemas/series-analysis-publication-contract-v2.json"
  private val Contract = loadContract()

  val ValidationContractId: String = Contract.hcursor.get[String]("validationContractId")
    .fold(error => sys.error(s"Invalid validation contract ID: $error"), identity)
  val ArtifactSchemaVersion: Int = Contract.hcursor.get[Int]("artifactSchemaVersion")
    .fold(error => sys.error(s"Invalid artifact schema version: $error"), identity)

  /** Ordered, exact pairs from the producer contract; never treat the columns as a cross product. */
  val ReadableContracts: Vector[(Int, String)] = Contract.hcursor
    .get[Vector[Json]]("readableContracts")
    .fold(error => sys.error(s"Invalid readable contracts: $error"), identity)
    .map { value =>
      if !value.asObject.exists(_.keys.toSet ==
          Set("artifactSchemaVersion", "validationContractId"))
      then sys.error("Invalid readable publication contract fields")
      val cursor = value.hcursor
      (for
        version <- cursor.get[Int]("artifactSchemaVersion")
        id <- cursor.get[String]("validationContractId")
      yield (version, id)).fold(error => sys.error(s"Invalid readable contract: $error"), identity)
    }
  val SupportedArtifactSchemas: Set[Int] = ReadableContracts.map(_._1).toSet
  val SupportedValidationContractIds: Set[String] = ReadableContracts.map(_._2).toSet

  locally:
    val contractVersion = Contract.hcursor.get[Int]("contractVersion")
      .fold(error => sys.error(s"Invalid publication contract version: $error"), identity)
    val exactFields = Set(
      "$comment",
      "artifactSchemaVersion",
      "contractVersion",
      "readableContracts",
      "validationContractId",
    )
    if contractVersion != 2 || ArtifactSchemaVersion < 1 ||
      !ValidationContractId.matches("^[a-z0-9][a-z0-9._-]{0,127}$") ||
      !Contract.asObject.exists(_.keys.toSet == exactFields) ||
      !ReadableContracts.contains((ArtifactSchemaVersion, ValidationContractId)) ||
      ReadableContracts.map(_._1) != ReadableContracts.map(_._1).distinct.sorted ||
      SupportedValidationContractIds.size != ReadableContracts.size ||
      !ReadableContracts.forall { case (version, id) =>
        version > 0 && id.matches("^[a-z0-9][a-z0-9._-]{0,127}$")
      }
    then sys.error("Unsupported Series analysis publication contract")

  def supports(schemaVersion: Int, validationContractId: Option[String]): Boolean =
    validationContractId.exists(id => ReadableContracts.contains((schemaVersion, id)))

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
