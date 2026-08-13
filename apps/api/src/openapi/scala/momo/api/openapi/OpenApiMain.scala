package momo.api.openapi

import java.nio.file.Path

object OpenApiMain:
  def main(args: Array[String]): Unit =
    val output = args.headOption.getOrElse("openapi.yaml")
    OpenApiGenerator.write(Path.of(output))
