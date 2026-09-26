import java.nio.file.{Files, Paths}

scalaVersion := "3.9.0"
semanticdbEnabled := true
evictionErrorLevel := Level.Error
// SLF4J keeps its client API binary compatible across 1.x and 2.x; Logback supplies the 2.x provider.
// https://www.slf4j.org/faq.html#compatibility
libraryDependencySchemes += "org.slf4j" % "slf4j-api" % VersionScheme.Always

addCommandAlias("apiFormat", "scalafmtAll")
addCommandAlias("apiFormatCheck", "scalafmtCheckAll")
addCommandAlias("apiLint", "scalafixAll --check")
addCommandAlias("apiQuality", "apiFormatCheck; apiLint; apiOpenApiCheck")
addCommandAlias("apiCheck", "apiQuality; test")
addCommandAlias("apiFullCheck", "apiCheck; apiDbQuality; apiRedisQuality")
addCommandAlias("apiCoverage", "clean; coverage; test; coverageReport; coverageOff")
addCommandAlias(
  "apiRedisQuality",
  "set Test / fork := true; " +
    "set Test / testOptions := Seq(); " +
    "testOnly * -- --include-tags=RedisIntegration",
)
addCommandAlias(
  "apiR2Quality",
  "set Test / fork := true; " +
    "set Test / parallelExecution := false; " +
    "set Test / testOptions := Seq(); " +
    "testOnly * -- --include-tags=R2Integration",
)
addCommandAlias(
  "apiDbQuality",
  "set Test / fork := true; " +
    "set Test / parallelExecution := false; " +
    "set Test / testOptions := Seq(); " +
    "testOnly * -- --include-tags=DbIntegration",
)

lazy val apiOpenApi = taskKey[File]("Generate OpenAPI from Tapir endpoint definitions")
lazy val apiOpenApiCheck = taskKey[Unit]("Check that openapi.yaml matches generated Tapir output")
lazy val OpenApi = config("openapi").hide.extend(Compile)

lazy val nettyVersion = "4.2.18.Final"
lazy val http4sVersion = "0.23.36"
lazy val http4sPatchedVersion =
  sys.props
    .get("momo.http4s.patched.version")
    .orElse(sys.env.get("MOMO_HTTP4S_PATCHED_VERSION"))
    .filter(_.nonEmpty)
lazy val http4sEmberVersion = http4sPatchedVersion.getOrElse(http4sVersion)
// Keep the reviewed http4s release and fork together even when integrations upgrade transitively.
lazy val http4sOverrides = Seq(
  "org.http4s" %% "http4s-core" % http4sEmberVersion,
  "org.http4s" %% "http4s-server" % http4sEmberVersion,
  "org.http4s" %% "http4s-ember-core" % http4sEmberVersion,
  "org.http4s" %% "http4s-ember-server" % http4sEmberVersion,
  "org.http4s" %% "http4s-circe" % http4sVersion,
  "org.http4s" %% "http4s-jawn" % http4sVersion,
)
lazy val isMacOs =
  sys.props.getOrElse("os.name", "").toLowerCase(java.util.Locale.ROOT).contains("mac")

lazy val macOsNettyDnsResolver: Seq[ModuleID] = {
  val osArch = sys.props.getOrElse("os.arch", "").toLowerCase(java.util.Locale.ROOT)
  if (!isMacOs) Seq.empty
  else {
    val classifier = osArch match {
      case "aarch64" | "arm64" => "osx-aarch_64"
      case "amd64" | "x86_64" => "osx-x86_64"
      case unsupported =>
        sys.error(s"Unsupported macOS architecture for Netty DNS resolver: $unsupported")
    }
    Seq(
      ("io.netty" % "netty-resolver-dns-native-macos" % nettyVersion % Runtime)
        .classifier(classifier)
    )
  }
}

// Scalac options shared by Compile and Test.
//
// Goal: catch as many bugs as possible at compile time, and force AI-generated
// code to be precise. Each flag is paired with a short rationale.
lazy val sharedScalacOptions = Seq(
  "-release:25", // match the JDK API and bytecode used by the production runtime
  "-deprecation", // do not silently use deprecated API
  "-encoding",
  "UTF-8",
  "-explain", // verbose error messages help AI/humans debug type errors
  "-feature", // require explicit imports for advanced features
  "-unchecked", // surface unsafe pattern matches and erasures
  "-Wunused:all", // unused imports/vals/params/locals/privates
  "-Wvalue-discard", // accidental discard of a non-Unit value is an error
  "-Wnonunit-statement", // expressions that compute a non-Unit value cannot be statements
  "-Wimplausible-patterns", // unreachable case branches (Scala 3.4+)
  "-Wsafe-init", // detect bad object initialization order
  "-Xverify-signatures", // ensure ASM-emitted signatures match Scala types
  "-Werror", // promote all warnings above to errors
  "-language:strictEquality", // forbid `==` between unrelated types (CanEqual required)
)

lazy val root = (project in file("."))
  .configs(OpenApi)
  .enablePlugins(JavaAppPackaging)
  .settings(
    inConfig(OpenApi)(Defaults.compileSettings),
    org.scalafmt.sbt.ScalafmtPlugin.scalafmtConfigSettings(OpenApi),
    scalafixConfigSettings(OpenApi),
    OpenApi / compile := Def.uncached((OpenApi / compile).dependsOn(Compile / compile).value),
    name := "momo-result-api",
    organization := "momo",
    scalacOptions ++= sharedScalacOptions,
    Compile / scalacOptions ++= {
      // Scala 3.9 skips oversized schema initializers to avoid the JVM's 64 KiB method limit.
      // Keep that coverage limitation visible without relaxing warnings for application code.
      // https://github.com/scala/scala3/blob/3.9.0/compiler/src/dotty/tools/dotc/transform/InstrumentCoverage.scala
      if (coverageEnabled.value) Seq(
        "-Wconf:msg=^Skipping coverage instrumentation for large value initializer .*" +
          "&src=.*[\\\\/]momo[\\\\/]api[\\\\/]endpoints[\\\\/].*:i"
      )
      else Seq.empty
    },
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
    Compile / resourceGenerators += Def.task {
      Def.uncached {
        val schemaNames = Seq(
          "series-analysis-aggregate-v5.schema.json",
          "series-analysis-drilldown-v3.schema.json",
          "series-analysis-match-context-v1.schema.json",
          "series-analysis-publication-contract-v2.json",
          "series-analysis-review-v4.schema.json",
        )
        val sourceDirectory = baseDirectory.value / ".." / ".." / "docs" / "schemas"
        val outputDirectory = (Compile / resourceManaged).value / "momo" / "api" /
          "series-analysis-schemas"
        IO.createDirectory(outputDirectory)
        schemaNames.sorted.map { schemaName =>
          val source = sourceDirectory / schemaName
          val output = outputDirectory / schemaName
          if (!source.isFile) {
            sys.error(s"Series analysis resource schema is missing: ${source.getAbsolutePath}")
          }
          if (!output.isFile || Files.mismatch(source.toPath, output.toPath) != -1L) {
            IO.copyFile(source, output)
          }
          output
        }
      }
    }.taskValue,
    Compile / run / fork := true,
    Compile / run / javaOptions ++=
      Seq("-Dcats.effect.warnOnNonMainThreadDetected=false") ++
        (if (isMacOs) Seq("--enable-native-access=ALL-UNNAMED") else Seq.empty),
    Test / testOptions += Tests.Argument(
      TestFrameworks.MUnit,
      "--exclude-tags=DbIntegration,RedisIntegration,R2Integration",
    ),
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
    coverageFailOnMinimum := false,
    coverageExcludedPackages := "momo\\.api\\.Main",
    coverageExcludedFiles := Seq(
      ".*/momo/api/adapters/postgres/.*",
      ".*/momo/api/adapters/redis/.*",
    ).mkString(";"),
    libraryDependencies ++= {
      val catsEffectVersion = "3.7.1"
      val apiSpecVersion = "0.11.10"
      val awsSdkVersion = "2.55.6"
      val circeVersion = "0.14.16"
      val cirisVersion = "3.15.1"
      val doobieVersion = "1.0.0-RC12"
      val ironVersion = "3.3.2"
      val logbackVersion = "1.6.4"
      val logstashEncoderVersion = "9.0"
      val jsonSchemaValidatorVersion = "3.0.7"
      val log4catsVersion = "2.8.0"
      val munitCatsEffectVersion = "2.2.1"
      val munitVersion = "1.3.6"
      val redis4catsVersion = "2.0.6"
      val tapirVersion = "1.13.31"
      val testcontainersVersion = "2.0.5"

      Seq(
        "org.typelevel" %% "cats-effect" % catsEffectVersion,
        ("software.amazon.awssdk" % "s3" % awsSdkVersion)
          .exclude("software.amazon.awssdk", "apache5-client")
          .exclude("software.amazon.awssdk", "netty-nio-client"),
        "software.amazon.awssdk" % "url-connection-client" % awsSdkVersion,
        "is.cir" %% "ciris" % cirisVersion,
        "org.typelevel" %% "log4cats-slf4j" % log4catsVersion,
        "org.http4s" %% "http4s-ember-server" % http4sEmberVersion,
        "org.http4s" %% "http4s-circe" % http4sVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-core" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-json-circe" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-http4s-server" % tapirVersion,
        "com.softwaremill.sttp.tapir" %% "tapir-openapi-docs" % tapirVersion % OpenApi,
        "com.softwaremill.sttp.apispec" %% "openapi-circe" % apiSpecVersion % OpenApi,
        "io.circe" %% "circe-core" % circeVersion,
        "io.circe" %% "circe-jawn" % circeVersion,
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
        "com.networknt" % "json-schema-validator" % jsonSchemaValidatorVersion,
        "org.scalameta" %% "munit" % munitVersion % Test,
        "org.testcontainers" % "testcontainers-postgresql" % testcontainersVersion % Test,
        "org.testcontainers" % "testcontainers" % testcontainersVersion % Test,
        "org.typelevel" %% "cats-effect-testkit" % catsEffectVersion % Test,
        "org.typelevel" %% "munit-cats-effect" % munitCatsEffectVersion % Test
      ) ++ macOsNettyDnsResolver
    },
    dependencyOverrides ++= {
      val jacksonVersion = "3.2.3"

      Seq(
        "io.netty" % "netty-buffer" % nettyVersion,
        "io.netty" % "netty-codec-dns" % nettyVersion,
        "io.netty" % "netty-common" % nettyVersion,
        "io.netty" % "netty-handler" % nettyVersion,
        "io.netty" % "netty-resolver" % nettyVersion,
        "io.netty" % "netty-resolver-dns" % nettyVersion,
        "io.netty" % "netty-transport" % nettyVersion,
        "io.netty" % "netty-transport-native-unix-common" % nettyVersion,
        "org.postgresql" % "postgresql" % "42.7.13",
        "tools.jackson.core" % "jackson-core" % jacksonVersion,
        "tools.jackson.core" % "jackson-databind" % jacksonVersion,
      ) ++ http4sOverrides
    },
    apiOpenApi := Def.uncached {
      val converter = fileConverter.value
      val output = baseDirectory.value / "openapi.yaml"
      val result = (OpenApi / runner).value.run(
        "momo.api.openapi.OpenApiMain",
        (OpenApi / fullClasspath).value.map(entry => converter.toPath(entry.data)),
        Seq(output.getAbsolutePath),
        streams.value.log
      )
      result.failed.foreach(error => throw error)
      output
    },
    apiOpenApiCheck := Def.uncached {
      val converter = fileConverter.value
      val output = baseDirectory.value / "openapi.yaml"
      if (!output.exists()) sys.error(s"OpenAPI file does not exist: ${output.getAbsolutePath}")
      val generated = Files.createTempFile("momo-result-openapi-", ".yaml")
      try {
        val result = (OpenApi / runner).value.run(
          "momo.api.openapi.OpenApiMain",
          (OpenApi / fullClasspath).value.map(entry => converter.toPath(entry.data)),
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
