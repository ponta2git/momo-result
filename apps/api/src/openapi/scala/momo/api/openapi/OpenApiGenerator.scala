package momo.api.openapi

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

import io.circe.syntax.*
import io.circe.{Json, JsonObject}
import sttp.apispec.openapi.OpenAPI
import sttp.apispec.openapi.circe.*
import sttp.tapir.docs.openapi.OpenAPIDocsInterpreter

import momo.api.contracts.seriesanalysis.SeriesAnalysisResponseSchemas
import momo.api.domain.SeriesAnalysisDrilldownMetric
import momo.api.endpoints.ApiEndpoints

object OpenApiGenerator:
  private val DrilldownPath = "/api/analytics/series-comparison/v2/drilldown"

  private def rawOpenApi: OpenAPI = OpenAPIDocsInterpreter()
    .toOpenAPI(ApiEndpoints.all, "Momo Result API", "0.1.0")

  def yaml: String = withoutTrailingWhitespace(withDocumentedContracts(rawOpenApi.asJson).spaces2)

  def write(path: Path): Unit =
    Option(path.getParent).foreach(parent => Files.createDirectories(parent): Unit)
    Files.writeString(path, yaml, StandardCharsets.UTF_8): Unit

  private def withoutTrailingWhitespace(value: String): String = value.linesIterator
    .map(line =>
      val lastContentIndex = line.lastIndexWhere(character => !character.isWhitespace)
      if lastContentIndex < 0 then "" else line.substring(0, lastContentIndex + 1)
    )
    .mkString("\n")

  private def withDocumentedContracts(document: Json): Json =
    withDrilldownMetricIds(withResponseSchemas(document))

  private def withResponseSchemas(document: Json): Json =
    SeriesAnalysisResponseSchemas.resources.foldLeft(document) { (current, resource) =>
      val componentName = resource.componentName
      val cursor = current.hcursor
        .downField("components")
        .downField("schemas")
        .downField(componentName)
      val expectedMarker = Json.obj(
        "title" -> Json.fromString(componentName),
        "type" -> Json.fromString("object"),
      )
      if !cursor.focus.contains(expectedMarker) then
        sys.error(s"Series analysis OpenAPI raw-byte marker changed: $componentName")
      cursor.withFocus(_ => SeriesAnalysisResponseSchemas.schemaFor(resource)).top
        .getOrElse(
          sys.error(s"Failed to replace series analysis OpenAPI schema: $componentName")
        )
    }

  private def withDrilldownMetricIds(document: Json): Json =
    val root = objectValue(document, "OpenAPI document")
    val paths = objectField(root, "paths", "OpenAPI document")
    val path = objectField(paths, DrilldownPath, "OpenAPI paths")
    val operation = objectField(path, "get", "series analysis drilldown path")
    val parameters = operation("parameters").flatMap(_.asArray).getOrElse(
      sys.error("Series analysis drilldown OpenAPI parameters are missing.")
    )
    val metricIndexes = parameters.zipWithIndex.collect {
      case (parameter, index)
          if parameter.hcursor.get[String]("name").toOption.contains("metricId") &&
            parameter.hcursor.get[String]("in").toOption.contains("query") =>
        index
    }
    if metricIndexes.size != 1 then
      sys.error("Series analysis drilldown OpenAPI metricId query parameter is not unique.")
    val metricIndex = metricIndexes.head
    val metricParameter = objectValue(parameters(metricIndex), "drilldown metricId parameter")
    val metricSchema = objectField(metricParameter, "schema", "drilldown metricId parameter")
    if metricSchema("type").flatMap(_.asString) != Some("string") then
      sys.error("Series analysis drilldown OpenAPI metricId is not a string schema.")
    if metricSchema.contains("enum") then
      sys.error(
        "Series analysis drilldown metricId must keep runtime validation in the API codec."
      )
    val documentedSchema = metricSchema.add(
      "enum",
      Json.fromValues(SeriesAnalysisDrilldownMetric.supportedIds.map(Json.fromString)),
    )
    val documentedParameter = metricParameter.add(
      "schema",
      Json.fromJsonObject(documentedSchema),
    )
    val documentedOperation = operation.add(
      "parameters",
      Json.fromValues(
        parameters.updated(metricIndex, Json.fromJsonObject(documentedParameter))
      ),
    )
    val documentedPath = path.add("get", Json.fromJsonObject(documentedOperation))
    val documentedPaths = paths.add(DrilldownPath, Json.fromJsonObject(documentedPath))
    Json.fromJsonObject(root.add("paths", Json.fromJsonObject(documentedPaths)))

  private def objectField(parent: JsonObject, field: String, context: String): JsonObject =
    parent(field).flatMap(_.asObject).getOrElse(
      sys.error(s"$context object field is missing: $field")
    )

  private def objectValue(value: Json, context: String): JsonObject = value.asObject.getOrElse(
    sys.error(s"$context is not a JSON object.")
  )
