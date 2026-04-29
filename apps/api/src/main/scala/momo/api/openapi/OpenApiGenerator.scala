package momo.api.openapi

import momo.api.endpoints.ApiEndpoints
import io.circe.syntax.*
import sttp.apispec.openapi.OpenAPI
import sttp.apispec.openapi.circe.*
import sttp.tapir.docs.openapi.OpenAPIDocsInterpreter

import java.nio.file.Files
import java.nio.file.Path
import java.nio.charset.StandardCharsets

object OpenApiGenerator:
  def openApi: OpenAPI =
    OpenAPIDocsInterpreter()
      .toOpenAPI(ApiEndpoints.all, "Momo Result API", "0.1.0")

  def yaml: String =
    openApi.asJson.spaces2

  def write(path: Path): Unit =
    Option(path.getParent).foreach(Files.createDirectories(_))
    Files.writeString(path, yaml, StandardCharsets.UTF_8)
