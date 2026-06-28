package momo.api.config

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import munit.FunSuite

final class ConfigArchitectureSpec extends FunSuite:
  private val configRoot = Paths.get("src/main/scala/momo/api/config")

  test("config boundary parsers use Ciris ConfigValue and Iron refined decoders"):
    val text = read(configRoot.resolve("ConfigParsers.scala"))

    assert(text.contains("ConfigValue[Effect"))
    assert(text.contains("io.github.iltotore.iron.ciris.given"))
    assert(!text.contains("toIntOption"))
    assert(!text.contains("toLongOption"))

  test("config loaders do not parse numeric env values directly"):
    val checked = List(
      "AppConfig.scala",
      "AuthConfigLoader.scala",
      "DatabaseConfigLoader.scala",
      "RedisConfigLoader.scala",
      "ResourceLimitsConfigLoader.scala",
    ).map(configRoot.resolve)
    val violations = checked.filter { path =>
      val text = read(path)
      text.contains("toIntOption") || text.contains("toLongOption")
    }.map(_.toString)

    assertEquals(violations, Nil)

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

end ConfigArchitectureSpec
