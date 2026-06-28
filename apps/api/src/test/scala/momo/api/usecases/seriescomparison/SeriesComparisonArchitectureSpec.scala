package momo.api.usecases.seriescomparison

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class SeriesComparisonArchitectureSpec extends FunSuite:
  private val engineRoot =
    Paths.get("src/main/scala/momo/api/usecases/seriescomparison/engine")
  private val comparisonRoot =
    Paths.get("src/main/scala/momo/api/usecases/seriescomparison")

  test("series comparison engine is independent from HTTP, repository, and endpoint DTO layers"):
    val forbiddenImports = List(
      "momo.api.endpoints",
      "momo.api.http",
      "momo.api.repositories",
      "cats.effect",
      "sttp.tapir",
    )
    val violations = scalaFiles(engineRoot).flatMap { path =>
      val text = read(path)
      forbiddenImports.filter(text.contains).map(pattern => s"$path: $pattern")
    }.sorted

    assertEquals(violations, Nil)

  test("series comparison aggregations receive the engine dataset at the boundary"):
    val aggregateFiles = List(
      comparisonRoot.resolve("SeriesComparisonAggregation.scala"),
      comparisonRoot.resolve("SeriesComparisonReviewAggregation.scala"),
      comparisonRoot.resolve("SeriesComparisonDrilldownAggregation.scala"),
    )
    val violations = aggregateFiles.filterNot(path => read(path).contains("dataset: SeriesDataset"))

    assertEquals(violations, Nil)

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

end SeriesComparisonArchitectureSpec
