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
  private val endpointDir = Paths.get("src/main/scala/momo/api/endpoints")

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

  test("series comparison usecases are independent from endpoint DTO and codec layers"):
    val checkedFiles = scalaFiles(comparisonRoot)
    val forbiddenImports = List(
      "momo.api.endpoints",
      "io.circe",
      "sttp.tapir",
    )
    val violations = checkedFiles.flatMap { path =>
      val text = read(path)
      forbiddenImports.filter(text.contains).map(pattern => s"$path: $pattern")
    }.sorted

    assertEquals(violations, Nil)

  test("series comparison endpoint models are codec schema facade aliases"):
    val text = scalaFiles(endpointDir)
      .filter(_.getFileName.toString.startsWith("SeriesComparison"))
      .filter(_.getFileName.toString.endsWith("ApiModels.scala"))
      .map(read)
      .mkString("\n")

    assert(text.contains("import momo.api.usecases.seriescomparison.view"))
    assert(text.contains("type SeriesComparisonResponse = view.SeriesComparisonView"))
    assert(
      text.contains("type SeriesComparisonReviewResponse = view.SeriesComparisonReviewView")
    )
    assert(text.contains(
      "type SeriesComparisonDrilldownResponse = view.SeriesComparisonDrilldownView"
    ))
    assert(!text.contains("final case class SeriesComparisonResponse"))

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

end SeriesComparisonArchitectureSpec
