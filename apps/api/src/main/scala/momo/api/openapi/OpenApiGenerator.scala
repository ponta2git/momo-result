package momo.api.openapi

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

import io.circe.syntax.*
import sttp.apispec.openapi.OpenAPI
import sttp.apispec.openapi.circe.*
import sttp.tapir.docs.openapi.OpenAPIDocsInterpreter

import momo.api.endpoints.ApiEndpoints

object OpenApiGenerator:
  def openApi: OpenAPI = OpenAPIDocsInterpreter()
    .toOpenAPI(ApiEndpoints.all, "Momo Result API", "0.1.0")

  def yaml: String = openApi.asJson.spaces2

  def write(path: Path): Unit =
    Option(path.getParent).foreach(parent => Files.createDirectories(parent): Unit)
    Files.writeString(path, yaml, StandardCharsets.UTF_8): Unit
