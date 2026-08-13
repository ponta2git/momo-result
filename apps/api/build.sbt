import java.nio.file.{Files, Paths}

ThisBuild / scalaVersion := "3.8.4"
ThisBuild / semanticdbEnabled := true
ThisBuild / evictionErrorLevel := Level.Warn

addCommandAlias("apiFormat", "scalafmtAll")
addCommandAlias("apiFormatCheck", "scalafmtCheckAll")
addCommandAlias("apiLint", "scalafixAll --check")
addCommandAlias("apiQuality", "apiFormatCheck; apiLint; Test / compile; apiOpenApiCheck")
addCommandAlias("apiCheck", "apiQuality; test")
addCommandAlias("apiFullCheck", "apiCheck; apiDbQuality; apiRedisQuality")
addCommandAlias("apiCoverage", "clean; coverage; test; coverageReport; coverageOff")
addCommandAlias(
  "apiCoverageReportOnly",
  "clean; set coverageFailOnMinimum := false; coverage; test; coverageReport; coverageOff",
)
addCommandAlias(
  "apiTestWithCoverageReportOnly",
  "set coverageFailOnMinimum := false; coverage; test; coverageReport; coverageOff",
)
addCommandAlias(
  "apiRedisQuality",
    "set Test / fork := true; " +
    "set Test / parallelExecution := false; " +
    "set Test / testOptions := Seq(); " +
    "testOnly momo.api.integration.redis.* -- --include-tags=RedisIntegration",
)
addCommandAlias(
  "apiR2Quality",
  "set Test / fork := true; " +
    "set Test / parallelExecution := false; " +
    "set Test / testOptions := Seq(); " +
    "testOnly momo.api.integration.r2.* -- --include-tags=R2Integration",
)
addCommandAlias(
  "apiDbQuality",
  "set Test / fork := true; " +
    "set Test / parallelExecution := false; " +
    "set Test / testOptions := Seq(); " +
    "testOnly momo.api.integration.* " +
    "-- --include-tags=DbIntegration",
)

lazy val apiOpenApi = taskKey[File]("Generate OpenAPI from Tapir endpoint definitions")
lazy val apiOpenApiCheck = taskKey[Unit]("Check that openapi.yaml matches generated Tapir output")
lazy val OpenApi = config("openapi").hide.extend(Compile)

lazy val nettyVersion = "4.2.15.Final"
lazy val isMacOs =
  sys.props.getOrElse("os.name", "").toLowerCase(java.util.Locale.ROOT).contains("mac")

lazy val macOsNettyDnsResolver: Seq[ModuleID] = {
  val osArch = sys.props.getOrElse("os.arch", "").toLowerCase(java.util.Locale.ROOT)
  if (!isMacOs) Seq.empty
  else {
    val classifier = osArch match {
      case "aarch64" | "arm64" => "osx-aarch_64"
      case "amd64" | "x86_64"  => "osx-x86_64"
      case unsupported =>
        sys.error(s"Unsupported macOS architecture for Netty DNS resolver: $unsupported")
    }
    Seq(
      "io.netty" % "netty-resolver-dns-native-macos" % nettyVersion % Runtime classifier classifier
    )
  }
}

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
  .configs(OpenApi)
  .enablePlugins(JavaAppPackaging)
  .settings(
    inConfig(OpenApi)(Defaults.compileSettings),
    org.scalafmt.sbt.ScalafmtPlugin.scalafmtConfigSettings(OpenApi),
    scalafixConfigSettings(OpenApi),
    OpenApi / compile := (OpenApi / compile).dependsOn(Compile / compile).value,
    name := "momo-result-api",
    organization := "momo",
    scalacOptions ++= sharedScalacOptions,
    // Keep the REPL usable without -Werror firing on incomplete snippets.
    Compile / console / scalacOptions ~= {
      _.filterNot(_ == "-Werror")
    },
    Test / console / scalacOptions ~= {
      _.filterNot(_ == "-Werror")
    },
    Compile / doc / sources := Seq.empty,
    Compile / packageDoc / publishArtifact := false,
    Compile / mainClass := Some("momo.api.Main"),
    Compile / run / fork := true,
    Compile / run / javaOptions ++=
      Seq("-Dcats.effect.warnOnNonMainThreadDetected=false") ++
        (if (isMacOs) Seq("--enable-native-access=ALL-UNNAMED") else Seq.empty),
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "--exclude-tags=Integration"),
    Test / testOptions += Tests.Filter(name => !name.startsWith("momo.api.integration.")),
    Test / parallelExecution := true,
    Test / fork := false,
    Test / envVars ++= {
      sys.env.get("DOCKER_HOST").fold {
        val dockerDesktopSocket = Paths.get(sys.props("user.home"), ".docker", "run", "docker.sock")
        if (Files.exists(dockerDesktopSocket)) {
          Map("DOCKER_HOST" -> s"unix://$dockerDesktopSocket")
        } else Map.empty[String, String]
      }(dockerHost => Map("DOCKER_HOST" -> dockerHost))
    },
    coverageFailOnMinimum := true,
    coverageMinimumStmtTotal := 80,
    coverageMinimumBranchTotal := 70,
    coverageExcludedPackages := "momo\\.api\\.Main",
    coverageExcludedFiles := Seq(
      ".*/momo/api/adapters/postgres/.*",
      ".*/momo/api/adapters/redis/.*",
    ).mkString(";"),
    libraryDependencies ++= {
      val catsEffectVersion = "3.7.0"
      val apiSpecVersion = "0.11.10"
      val awsSdkVersion = "2.51.4"
      val circeVersion = "0.14.15"
      val cirisVersion = "3.15.0"
      val doobieVersion = "1.0.0-RC12"
      val http4sVersion = "0.23.34"
      val ironVersion = "3.3.1"
      val logbackVersion = "1.5.34"
      val logstashEncoderVersion = "9.0"
      val janinoVersion = "3.1.12"
      val jsonSchemaValidatorVersion = "3.0.4"
      val log4catsVersion = "2.8.0"
      val munitCatsEffectVersion = "2.2.0"
      val munitVersion = "1.3.3"
      val redis4catsVersion = "2.0.4"
      val tapirVersion = "1.13.23"
      val testcontainersVersion = "2.0.5"

      Seq(
        "org.typelevel" %% "cats-effect" % catsEffectVersion,
        ("software.amazon.awssdk" % "s3" % awsSdkVersion)
          .exclude("software.amazon.awssdk", "apache5-client")
          .exclude("software.amazon.awssdk", "netty-nio-client"),
        "software.amazon.awssdk" % "url-connection-client" % awsSdkVersion,
        "is.cir" %% "ciris" % cirisVersion,
        "org.typelevel" %% "log4cats-slf4j" % log4catsVersion,
        "org.http4s" %% "http4s-ember-server" % http4sVersion,
        "org.http4s" %% "http4s-circe" % http4sVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-core" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-json-circe" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-http4s-server" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-openapi-docs" % tapirVersion % OpenApi,
        "com.softwaremill.sttp.apispec" %% "openapi-circe" % apiSpecVersion % OpenApi,
        "io.circe" %% "circe-core" % circeVersion,
        "io.circe" %% "circe-parser" % circeVersion,
        "io.github.iltotore" %% "iron" % ironVersion,
        "io.github.iltotore" %% "iron-ciris" % ironVersion,
        "org.tpolecat" %% "doobie-core" % doobieVersion,
        "org.tpolecat" %% "doobie-postgres" % doobieVersion,
        "org.tpolecat" %% "doobie-postgres-circe" % doobieVersion,
        "org.tpolecat" %% "doobie-hikari" % doobieVersion,
        "dev.profunktor" %% "redis4cats-effects" % redis4catsVersion,
        "ch.qos.logback" % "logback-classic" % logbackVersion,
        "net.logstash.logback" % "logstash-logback-encoder" % logstashEncoderVersion,
        "org.codehaus.janino" % "janino" % janinoVersion,
        "com.networknt" % "json-schema-validator" % jsonSchemaValidatorVersion % Test,
        "org.scalameta" %% "munit" % munitVersion % Test,
        "org.testcontainers" % "testcontainers-postgresql" % testcontainersVersion % Test,
        "org.testcontainers" % "testcontainers" % testcontainersVersion % Test,
        "org.typelevel" %% "munit-cats-effect" % munitCatsEffectVersion % Test
      ) ++ macOsNettyDnsResolver
    },
    dependencyOverrides ++= {
      val jacksonVersion = "3.2.0"

      Seq(
        "io.netty" % "netty-buffer" % nettyVersion,
        "io.netty" % "netty-codec-dns" % nettyVersion,
        "io.netty" % "netty-common" % nettyVersion,
        "io.netty" % "netty-handler" % nettyVersion,
        "io.netty" % "netty-resolver" % nettyVersion,
        "io.netty" % "netty-resolver-dns" % nettyVersion,
        "io.netty" % "netty-transport" % nettyVersion,
        "io.netty" % "netty-transport-native-unix-common" % nettyVersion,
        "org.postgresql" % "postgresql" % "42.7.12",
        "tools.jackson.core" % "jackson-core" % jacksonVersion,
        "tools.jackson.core" % "jackson-databind" % jacksonVersion,
      )
    },
    apiOpenApi := {
      val output = baseDirectory.value / "openapi.yaml"
      val result = (OpenApi / runner).value.run(
        "momo.api.openapi.OpenApiMain",
        (OpenApi / fullClasspath).value.files,
        Seq(output.getAbsolutePath),
        streams.value.log
      )
      result.failed.foreach(error => throw error)
      output
    },
    apiOpenApiCheck := {
      val output = baseDirectory.value / "openapi.yaml"
      if (!output.exists()) sys.error(s"OpenAPI file does not exist: ${output.getAbsolutePath}")
      val generated = Files.createTempFile("momo-result-openapi-", ".yaml")
      try {
        val result = (OpenApi / runner).value.run(
          "momo.api.openapi.OpenApiMain",
          (OpenApi / fullClasspath).value.files,
          Seq(generated.toAbsolutePath.toString),
          streams.value.log
        )
        result.failed.foreach(error => throw error)
        val expectedText = Files.readString(output.toPath)
        val generatedText = Files.readString(generated)
        if (expectedText != generatedText) {
          sys.error("openapi.yaml is stale. Run `sbt apiOpenApi` and commit the result.")
        }
      } finally Files.deleteIfExists(generated)
      ()
    }
  )
