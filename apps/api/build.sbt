import sbt.*
import sbt.Keys.*

ThisBuild / scalaVersion := "3.8.3"
ThisBuild / semanticdbEnabled := true
ThisBuild / semanticdbVersion := scalafixSemanticdb.revision
ThisBuild / evictionErrorLevel := Level.Warn
ThisBuild / versionScheme := Some("early-semver")

addCommandAlias("apiFormat", "scalafmtAll")
addCommandAlias("apiFormatCheck", "scalafmtCheckAll")
addCommandAlias("apiLint", "scalafixAll --check")
addCommandAlias("apiFix", "scalafixAll")
addCommandAlias("apiQuality", "apiFormatCheck; apiLint; Test / compile; apiOpenApiCheck")
addCommandAlias("apiCheck", "apiQuality; test")
addCommandAlias(
  "apiRedisQuality",
  "set Test / testOptions := Seq(); " +
    "testOnly momo.api.adapters.RedisQueueProducerSpec -- --include-tags=Integration",
)
addCommandAlias(
  "apiDbQuality",
  "testOnly momo.api.integration.DbContractSpec; " +
    "testOnly momo.api.integration.PostgresHeldEventsRepositoryContractSpec; " +
    "testOnly momo.api.integration.PostgresIdempotencyRepositoryContractSpec; " +
    "testOnly momo.api.integration.PostgresMatchesRepositorySpec; " +
    "testOnly momo.api.integration.PostgresMatchListReadModelSpec",
)

lazy val apiOpenApi = taskKey[File]("Generate OpenAPI from Tapir endpoint definitions")
lazy val apiOpenApiCheck = taskKey[Unit]("Check that openapi.yaml can be generated")

// Scalac options shared by Compile and Test.
//
// Goal: catch as many bugs as possible at compile time, and force AI-generated
// code to be precise. Each flag is paired with a short rationale.
lazy val sharedScalacOptions = Seq(
  "-deprecation",                // do not silently use deprecated API
  "-encoding", "UTF-8",
  "-explain",                    // verbose error messages help AI/humans debug type errors
  "-feature",                    // require explicit imports for advanced features
  "-unchecked",                  // surface unsafe pattern matches and erasures
  "-Wunused:all",                // unused imports/vals/params/locals/privates
  "-Wvalue-discard",             // accidental discard of a non-Unit value is an error
  "-Wnonunit-statement",         // expressions that compute a non-Unit value cannot be statements
  "-Wimplausible-patterns",      // unreachable case branches (Scala 3.4+)
  "-Wsafe-init",                 // detect bad object initialization order
  "-Xverify-signatures",         // ensure ASM-emitted signatures match Scala types
  "-Werror",                     // promote all warnings above to errors
  "-language:strictEquality",    // forbid `==` between unrelated types (CanEqual required)
)

lazy val root = (project in file("."))
  .settings(
    name := "momo-result-api",
    organization := "momo",
    scalacOptions ++= sharedScalacOptions,
    // Keep the REPL usable without -Werror / -Xfatal-warnings firing on incomplete snippets.
    Compile / console / scalacOptions ~= {
      _.filterNot(opt => opt == "-Werror" || opt.startsWith("-Xfatal"))
    },
    Test / console / scalacOptions ~= {
      _.filterNot(opt => opt == "-Werror" || opt.startsWith("-Xfatal"))
    },
    Compile / run / mainClass := Some("momo.api.Main"),
    Compile / run / fork := true,
    Compile / run / javaOptions += "-Dcats.effect.warnOnNonMainThreadDetected=false",
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "--exclude-tags=Integration"),
    Test / parallelExecution := false,
    Test / fork := false,
    libraryDependencies ++= {
      val catsEffectVersion = "3.7.0"
      val circeVersion = "0.14.15"
      val doobieVersion = "1.0.0-RC12"
      val http4sVersion = "0.23.34"
      val logbackVersion = "1.5.18"
      val logstashEncoderVersion = "8.0"
      val janinoVersion = "3.1.12"
      val log4catsVersion = "2.8.0"
      val munitCatsEffectVersion = "2.2.0"
      val munitVersion = "1.3.0"
      val redis4catsVersion = "1.7.2"
      val tapirVersion = "1.13.17"
      val testcontainersVersion = "1.21.3"

      Seq(
        "org.typelevel" %% "cats-effect" % catsEffectVersion,
        "org.typelevel" %% "log4cats-slf4j" % log4catsVersion,
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
        "dev.profunktor" %% "redis4cats-effects" % redis4catsVersion,
        "ch.qos.logback" % "logback-classic" % logbackVersion,
        "net.logstash.logback" % "logstash-logback-encoder" % logstashEncoderVersion,
        "org.codehaus.janino" % "janino" % janinoVersion,
        "org.scalameta" %% "munit" % munitVersion % Test,
        "org.testcontainers" % "testcontainers" % testcontainersVersion % Test,
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
