package momo.api.testing

import java.nio.file.{Files, Path}

import scala.jdk.CollectionConverters.*

import com.networknt.schema.{InputFormat, SchemaRegistry, SpecificationVersion}
import io.circe.Json
import munit.Assertions

import momo.api.contracts.ocrworker.OcrWorkerJobMessageV2

trait JsonSchemaAssertions extends Assertions:
  protected def assertOcrWorkerJobMessageV2SchemaValid(payloadJson: Json): Unit =
    assertJsonSchemaValid(streamPayloadV2SchemaPath, payloadJson.noSpaces)
    OcrWorkerJobMessageV2.fromJson(payloadJson) match
      case Left(reason) => fail(s"stream payload is not an OcrWorkerJobMessageV2: $reason")
      case Right(payload) => payload.fields.get(OcrWorkerJobMessageV2.HintsKey)
          .foreach(hintsJson => assertJsonSchemaValid(ocrHintsSchemaPath, hintsJson))

  protected def assertOcrWorkerJobMessageV2SchemaValid(payload: OcrWorkerJobMessageV2): Unit =
    assertOcrWorkerJobMessageV2SchemaValid(OcrWorkerJobMessageV2.fieldsAsJson(payload))

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

  protected def streamPayloadV2SchemaPath: Path =
    repoPath("docs/schemas/ocr-queue-payload-v2.schema.json")

  protected def ocrHintsSchemaPath: Path = repoPath("docs/schemas/ocr-hints-v1.schema.json")

  protected def seriesAnalysisArtifactSchemaPath: Path =
    repoPath("docs/schemas/series-analysis-artifact-v1.schema.json")

  protected def seriesAnalysisQueueSchemaPath: Path =
    repoPath("docs/schemas/series-analysis-queue-payload-v1.schema.json")

  protected def repositoryFile(relativePath: String): Path = repoPath(relativePath)

  private def jsonSchemaErrors(
      schemaPath: Path,
      inputJson: String,
  ): List[com.networknt.schema.Error] =
    val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
    val schema = registry.getSchema(Files.readString(schemaPath), InputFormat.JSON)
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
