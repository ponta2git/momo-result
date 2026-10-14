package momo.api.contracts.seriesanalysis

import java.nio.file.Files

import munit.FunSuite

import momo.api.testing.JsonSchemaAssertions

final class SeriesAnalysisArtifactContractSpec extends FunSuite with JsonSchemaAssertions:
  private val fixtureRoot = "docs/schemas/fixtures/series-analysis"

  test("artifact fixtures satisfy the shared JSON Schemas"):
    val currentSchema = repositoryFile("docs/schemas/series-analysis-artifact-v6.schema.json")
    assertJsonSchemaValid(currentSchema, fixture("valid-artifact-v6.json"))
    assertJsonSchemaInvalid(currentSchema, fixture("invalid-artifact-v6.json"))

  private def fixture(name: String): String =
    Files.readString(repositoryFile(s"$fixtureRoot/$name"))
