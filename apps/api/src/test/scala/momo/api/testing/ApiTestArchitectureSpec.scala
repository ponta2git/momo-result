package momo.api.testing

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class ApiTestArchitectureSpec extends FunSuite:
  private val testRoot = Paths.get("src/test/scala")
  private val integrationRoot = testRoot.resolve("momo/api/integration")
  private val redisIntegrationRoot = integrationRoot.resolve("redis")
  private val testingRoot = testRoot.resolve("momo/api/testing")
  private val usecaseTestingRoot = testRoot.resolve("momo/api/usecases/testing")
  private val buildFile = Paths.get("build.sbt")
  private val pluginsFile = Paths.get("project/plugins.sbt")
  private val testRuleFile = Paths.get("../../docs/test-rule.md")
  private val localIntegrationTagSyntax = "new munit.Tag(" + "\"Integration\"" + ")"

  test("integration tags are defined only through TestTags"):
    val violations = scalaFiles(testRoot).filterNot(_.endsWith(Paths.get("TestTags.scala")))
      .flatMap { path =>
        if read(path).contains(localIntegrationTagSyntax) then Some(path.toString) else None
      }.sorted

    assertEquals(violations, Nil)

  test("DB integration specs extend IntegrationSuite so they receive DB tags and cleanup"):
    val violations = scalaFiles(integrationRoot)
      .filterNot(path => path.startsWith(redisIntegrationRoot))
      .filter(path => path.getFileName.toString.endsWith("Spec.scala")).flatMap { path =>
        if read(path).contains("extends IntegrationSuite") then None else Some(path.toString)
      }.sorted

    assertEquals(violations, Nil)

  test("DB integration specs are discoverable by the apiDbQuality class pattern"):
    val violations = scalaFiles(integrationRoot)
      .filterNot(path => path.startsWith(redisIntegrationRoot))
      .filter(path => path.getFileName.toString.endsWith("Spec.scala")).flatMap { path =>
        val fileName = path.getFileName.toString
        if fileName.startsWith("Postgres") || fileName == "DbContractSpec.scala" then None
        else Some(path.toString)
      }.sorted

    assertEquals(violations, Nil)

  test("Redis integration specs extend RedisIntegrationSuite so they receive Redis tags"):
    val violations = scalaFiles(redisIntegrationRoot)
      .filter(path => path.getFileName.toString.endsWith("Spec.scala")).flatMap { path =>
        if read(path).contains("extends RedisIntegrationSuite") then None else Some(path.toString)
      }.sorted

    assertEquals(violations, Nil)

  test("Redis Testcontainer specs are explicitly tagged for the Redis gate"):
    val violations = scalaFiles(testRoot).filterNot(path => path.startsWith(redisIntegrationRoot))
      .filterNot(isArchitectureSpec).flatMap { path =>
        val text = read(path)
        val usesRedisContainer = text.contains("GenericContainer") && text.contains("redis:7")
        if usesRedisContainer then Some(path.toString) else None
      }.sorted

    assertEquals(violations, Nil)

  test("Testcontainers are limited to integration suites"):
    val forbiddenPatterns = List("org.testcontainers", "GenericContainer", "PostgreSQLContainer")
    val violations = scalaFiles(testRoot).filterNot(path => path.startsWith(integrationRoot))
      .filterNot(isArchitectureSpec).flatMap { path =>
        val text = read(path)
        forbiddenPatterns.filter(text.contains).map(pattern => s"$path: $pattern")
      }.sorted

    assertEquals(violations, Nil)

  test("external-service quality gates discover specs by capability tag, not manual class lists"):
    val text = read(buildFile)

    assert(text.contains("--include-tags=DbIntegration"))
    assert(text.contains("--include-tags=RedisIntegration"))
    assert(text.contains("testOnly momo.api.integration.Postgres*"))
    assert(text.contains("momo.api.integration.DbContractSpec"))
    assert(text.contains("testOnly momo.api.integration.redis.*"))
    assert(!text.contains("--include-tags=Integration\","))

  test("normal API tests stay parallel while external-service gates stay isolated"):
    val text = read(buildFile)

    assert(text.contains("Test / parallelExecution := true"))
    assert(text.contains("Test / fork := false"))
    assert(text.contains("--exclude-tags=Integration"))
    assert(text.contains("set Test / fork := true;"))
    assert(text.contains("set Test / parallelExecution := false;"))
    assert(text.contains("set Test / testOptions := Seq();"))

  test("API coverage gate is explicit and C2 policy is documented"):
    val buildText = read(buildFile)
    val pluginsText = read(pluginsFile)
    val testRuleText = read(testRuleFile)

    assert(pluginsText.contains("sbt-scoverage"))
    assert(buildText.contains("addCommandAlias(\"apiCoverage\""))
    assert(buildText.contains("coverageFailOnMinimum := true"))
    assert(buildText.contains("coverageMinimumStmtTotal :="))
    assert(buildText.contains("coverageMinimumBranchTotal :="))
    assert(buildText.contains("coverageExcludedPackages :="))
    assert(buildText.contains("coverageExcludedFiles :="))
    assert(testRuleText.contains("sbt apiCoverage"))
    assert(testRuleText.contains("C2"))
    assert(testRuleText.contains("table-driven test"))

  test("stateful API test doubles live in typed test support"):
    val forbiddenInlineDoubles = List(
      "new QueueProducer[IO]",
      "new OcrQueueOutboxRepository[IO]",
      "new OcrJobsRepository[IO]",
      "new ImageStore[IO]",
      "new RedisStreamClient[IO]",
      "new DiscordOAuthClient[IO]",
      "extends AppSessionsRepository[IO]",
    )
    val supportFiles = Set(
      Paths.get("src/test/scala/momo/api/testing/TestDoubles.scala"),
      Paths.get("src/test/scala/momo/api/usecases/testing/CapturingLoggerFactory.scala"),
    )
    val violations = scalaFiles(testRoot).filterNot(path => path.startsWith(testingRoot))
      .filterNot(path => path.startsWith(usecaseTestingRoot)).filterNot(supportFiles.contains)
      .flatMap { path =>
        val text = read(path)
        forbiddenInlineDoubles.filter(text.contains).map(pattern => s"$path: $pattern")
      }.sorted

    assertEquals(violations, Nil)

  test("lower-level API tests avoid wall-clock waits and shared writable temp config"):
    val forbiddenPatterns =
      List("Thread.sleep", "IO.sleep", "System.currentTimeMillis", "Instant.now(", "LocalDate.now(")
    val hardcodedWritableTempPatterns =
      List("imageTmpDir = Path.of(\"/tmp", "imageTmpDir = Paths.get(\"/tmp")
    val violations = scalaFiles(testRoot).filterNot(path => path.startsWith(integrationRoot))
      .filterNot(isArchitectureSpec).flatMap { path =>
        val text = read(path)
        forbiddenPatterns.filter(text.contains).map(pattern => s"$path: $pattern") ++
          hardcodedWritableTempPatterns.filter(text.contains).map(pattern => s"$path: $pattern")
      }.sorted

    assertEquals(violations, Nil)

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def isArchitectureSpec(path: Path): Boolean = path.getFileName.toString ==
    "ApiTestArchitectureSpec.scala"

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)
end ApiTestArchitectureSpec
