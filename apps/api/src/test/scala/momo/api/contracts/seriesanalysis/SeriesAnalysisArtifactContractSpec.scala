package momo.api.contracts.seriesanalysis

import java.nio.file.Files

import munit.FunSuite

import momo.api.testing.JsonSchemaAssertions

final class SeriesAnalysisArtifactContractSpec extends FunSuite with JsonSchemaAssertions:
  private val fixtureRoot = "docs/schemas/fixtures/series-analysis"

  test("artifact and queue fixtures satisfy the shared JSON Schemas"):
    assertJsonSchemaValid(
      seriesAnalysisArtifactSchemaPath,
      fixture("valid-artifact-v1.json"),
    )
    assertJsonSchemaInvalid(
      seriesAnalysisArtifactSchemaPath,
      fixture("invalid-artifact-v1.json"),
    )
    assertJsonSchemaValid(
      seriesAnalysisQueueSchemaPath,
      fixture("valid-queue-payload-v1.json"),
    )
    assertJsonSchemaInvalid(
      seriesAnalysisQueueSchemaPath,
      fixture("invalid-queue-payload-v1.json"),
    )

  private def fixture(name: String): String =
    Files.readString(repositoryFile(s"$fixtureRoot/$name"))
