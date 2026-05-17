package momo.api.testing

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class ApiTestArchitectureSpec extends FunSuite:
  private val testRoot = Paths.get("src/test/scala")
  private val integrationRoot = testRoot.resolve("momo/api/integration")
  private val redisIntegrationRoot = integrationRoot.resolve("redis")
  private val buildFile = Paths.get("build.sbt")
  private val localIntegrationTagSyntax = "new munit.Tag(" + "\"Integration\"" + ")"

  test("integration tags are defined only through TestTags"):
    val violations = scalaFiles(testRoot).filterNot(_.endsWith(Paths.get("TestTags.scala")))
      .flatMap { path =>
        if read(path).contains(localIntegrationTagSyntax) then Some(path.toString)
        else None
      }.sorted

    assertEquals(violations, Nil)

  test("DB integration specs extend IntegrationSuite so they receive DB tags and cleanup"):
    val violations = scalaFiles(integrationRoot)
      .filterNot(path => path.startsWith(redisIntegrationRoot))
      .filter(path => path.getFileName.toString.endsWith("Spec.scala"))
      .flatMap { path =>
        if read(path).contains("extends IntegrationSuite") then None else Some(path.toString)
      }.sorted

    assertEquals(violations, Nil)

  test("DB integration specs are discoverable by the apiDbQuality class pattern"):
    val violations = scalaFiles(integrationRoot)
      .filterNot(path => path.startsWith(redisIntegrationRoot))
      .filter(path => path.getFileName.toString.endsWith("Spec.scala"))
      .flatMap { path =>
        val fileName = path.getFileName.toString
        if fileName.startsWith("Postgres") || fileName == "DbContractSpec.scala" then None
        else Some(path.toString)
      }.sorted

    assertEquals(violations, Nil)

  test("Redis integration specs extend RedisIntegrationSuite so they receive Redis tags"):
    val violations = scalaFiles(redisIntegrationRoot)
      .filter(path => path.getFileName.toString.endsWith("Spec.scala"))
      .flatMap { path =>
        if read(path).contains("extends RedisIntegrationSuite") then None else Some(path.toString)
      }.sorted

    assertEquals(violations, Nil)

  test("Redis Testcontainer specs are explicitly tagged for the Redis gate"):
    val violations = scalaFiles(testRoot).filterNot(path => path.startsWith(redisIntegrationRoot))
      .filterNot(path => path.getFileName.toString == "ApiTestArchitectureSpec.scala")
      .flatMap { path =>
        val text = read(path)
        val usesRedisContainer = text.contains("GenericContainer") && text.contains("redis:7")
        if usesRedisContainer then Some(path.toString) else None
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

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)
end ApiTestArchitectureSpec
