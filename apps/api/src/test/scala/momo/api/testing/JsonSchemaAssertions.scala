package momo.api.testing

import java.nio.file.{Files, Path}

import scala.jdk.CollectionConverters.*

import com.networknt.schema.{InputFormat, SchemaRegistry, SpecificationVersion}
import io.circe.Json
import munit.Assertions

import momo.api.contracts.ocrworker.OcrJobInputSnapshot

trait JsonSchemaAssertions extends Assertions:
  protected def assertOcrJobInputSnapshotSchemaValid(payloadJson: Json): Unit =
    assertJsonSchemaValid(ocrJobInputSchemaPath, payloadJson.noSpaces)
    OcrJobInputSnapshot.fromJson(payloadJson) match
      case Left(reason) => fail(s"job input snapshot is not an OcrJobInputSnapshot: $reason")
      case Right(payload) => payload.fields.get(OcrJobInputSnapshot.HintsKey)
          .foreach(hintsJson => assertJsonSchemaValid(ocrHintsSchemaPath, hintsJson))

  protected def assertOcrJobInputSnapshotSchemaValid(payload: OcrJobInputSnapshot): Unit =
    assertOcrJobInputSnapshotSchemaValid(OcrJobInputSnapshot.toJson(payload))

  protected def assertJsonSchemaValid(schemaPath: Path, inputJson: String): Unit =
    val errors = jsonSchemaErrors(schemaPath, inputJson)

    assert(
      errors.isEmpty,
      s"JSON Schema validation failed for ${schemaPath.getFileName}: ${errors.mkString("; ")}",
    )

  protected def assertJsonSchemaInvalid(schemaPath: Path, inputJson: String): Unit =
    val errors = jsonSchemaErrors(schemaPath, inputJson)

    assert(
      errors.nonEmpty,
      s"JSON Schema validation unexpectedly passed for ${schemaPath.getFileName}: $inputJson",
    )

  protected def assertInlineJsonSchemaValid(
      schemaName: String,
      schemaJson: String,
      inputJson: String,
  ): Unit =
    val errors = jsonSchemaErrors(schemaJson, inputJson)

    assert(
      errors.isEmpty,
      s"JSON Schema validation failed for $schemaName: ${errors.mkString("; ")}",
    )

  protected def ocrJobInputSchemaPath: Path =
    repoPath("docs/schemas/ocr-job-input-v2.schema.json")

  protected def ocrHintsSchemaPath: Path = repoPath("docs/schemas/ocr-hints-v1.schema.json")

  protected def seriesAnalysisArtifactSchemaPath: Path =
    repoPath("docs/schemas/series-analysis-artifact-v6.schema.json")

  protected def repositoryFile(relativePath: String): Path = repoPath(relativePath)

  private def jsonSchemaErrors(
      schemaPath: Path,
      inputJson: String,
  ): List[com.networknt.schema.Error] = jsonSchemaErrors(Files.readString(schemaPath), inputJson)

  private def jsonSchemaErrors(
      schemaJson: String,
      inputJson: String,
  ): List[com.networknt.schema.Error] =
    val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
    val schema = registry.getSchema(schemaJson, InputFormat.JSON)
    schema.validate(
      inputJson,
      InputFormat.JSON,
      executionContext =>
        executionContext.executionConfig { executionConfig =>
          executionConfig.formatAssertionsEnabled(true)
          ()
        },
    ).asScala.toList

  private def repoPath(relativePath: String): Path =
    val cwd = Path.of(sys.props("user.dir"))
    val candidates = List(cwd.resolve(relativePath), cwd.resolve(s"../../$relativePath"))
      .map(_.normalize)
    candidates.find(path => Files.exists(path))
      .getOrElse(fail(s"repository path not found: $relativePath from cwd=$cwd"))
