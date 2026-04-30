import sbt.*
import sbt.Keys.*

ThisBuild / scalaVersion := "3.8.3"
ThisBuild / semanticdbEnabled := true
ThisBuild / semanticdbVersion := scalafixSemanticdb.revision

addCommandAlias("apiFormat", "scalafmtAll")
addCommandAlias("apiFormatCheck", "scalafmtCheckAll")
addCommandAlias("apiLint", "scalafixAll --check")
addCommandAlias("apiFix", "scalafixAll")
addCommandAlias("apiQuality", "apiFormatCheck; apiLint; Test / compile; apiOpenApiCheck")

lazy val apiOpenApi = taskKey[File]("Generate OpenAPI from Tapir endpoint definitions")
lazy val apiOpenApiCheck = taskKey[Unit]("Check that openapi.yaml can be generated")

lazy val root = (project in file("."))
  .settings(
    name := "momo-result-api",
    organization := "momo",
    scalacOptions ++= Seq(
      "-deprecation",
      "-encoding",
      "UTF-8",
      "-explain",
      "-feature",
      "-unchecked",
      "-Wunused:all",
      "-Wvalue-discard",
      "-Wnonunit-statement",
      "-Werror",
      "-language:strictEquality"
    ),
    Compile / run / mainClass := Some("momo.api.Main"),
    Compile / run / fork := true,
    Compile / run / javaOptions += "-Dcats.effect.warnOnNonMainThreadDetected=false",
    Test / parallelExecution := false,
    Test / fork := false,
    libraryDependencies ++= {
      val catsEffectVersion = "3.7.0"
      val circeVersion = "0.14.15"
      val doobieVersion = "1.0.0-RC12"
      val http4sVersion = "0.23.34"
      val munitCatsEffectVersion = "2.2.0"
      val munitVersion = "1.3.0"
      val tapirVersion = "1.13.17"

      Seq(
        "org.typelevel" %% "cats-effect" % catsEffectVersion,
        "org.http4s" %% "http4s-ember-server" % http4sVersion,
        "org.http4s" %% "http4s-dsl" % http4sVersion,
        "org.http4s" %% "http4s-circe" % http4sVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-core" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-json-circe" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-http4s-server" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-swagger-ui-bundle" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-openapi-docs" % tapirVersion,
        "io.circe" %% "circe-core" % circeVersion,
        "io.circe" %% "circe-generic" % circeVersion,
        "io.circe" %% "circe-parser" % circeVersion,
        "org.tpolecat" %% "doobie-core" % doobieVersion,
        "org.tpolecat" %% "doobie-postgres" % doobieVersion,
        "org.tpolecat" %% "doobie-postgres-circe" % doobieVersion,
        "org.tpolecat" %% "doobie-hikari" % doobieVersion,
        "org.scalameta" %% "munit" % munitVersion % Test,
        "org.typelevel" %% "munit-cats-effect" % munitCatsEffectVersion % Test
      )
    },
    apiOpenApi := {
      val output = baseDirectory.value / "openapi.yaml"
      val result = (Compile / runner).value.run(
        "momo.api.openapi.OpenApiMain",
        (Compile / fullClasspath).value.files,
        Seq(output.getAbsolutePath),
        streams.value.log
      )
      result.failed.foreach(error => throw error)
      output
    },
    apiOpenApiCheck := {
      val output = apiOpenApi.value
      if (!output.exists()) sys.error(s"OpenAPI was not generated: ${output.getAbsolutePath}")
      ()
    }
  )
