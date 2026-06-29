package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class PostgresRepositoryArchitectureSpec extends FunSuite:
  private val matchListReadModel =
    Paths.get("src/main/scala/momo/api/adapters/postgres/PostgresMatchListReadModel.scala")
  private val seriesComparisonReadModel = Paths.get(
    "src/main/scala/momo/api/adapters/postgres/PostgresSeriesComparisonReadModel.scala"
  )
  private val postgresDir = Paths.get("src/main/scala/momo/api/adapters/postgres")

  test("match list read-model maps DB rows through named fields"):
    val text = read(matchListReadModel)

    assert(text.contains("private final case class Row("))
    assert(!text.contains("private type Row = ("))
    assert(!text.contains("row._"))

  test("series comparison read-model keeps SQL row shape out of domain mapping"):
    val text = read(seriesComparisonReadModel)

    assert(text.contains("private final case class SeriesRow("))
    assert(text.contains("private final case class ScopeOptionRow("))
    assert(text.contains("private final case class PlayerRow("))
    assert(!text.contains("private type SeriesRow = ("))
    assert(!text.contains("private type ScopeOptionRow = ("))
    assert(!text.contains("private type PlayerRow = ("))
    assert(!text.contains("Read[("))
    assert(!text.contains(".query[("))
    assert(!text.contains("row._"))

  test("Postgres repositories map shared domain aggregates through explicit row types"):
    val directDomainQueries = List(
      "AppSession",
      "GameTitle",
      "HeldEvent",
      "IncidentMaster",
      "LoginAccount",
      "MapMaster",
      "Member",
      "MemberAlias",
      "SeasonMaster",
    )
    val pattern = raw"""query\[(${directDomainQueries.mkString("|")})\]""".r
    val violations = scalaFiles(postgresDir).flatMap { path =>
      pattern.findAllMatchIn(read(path)).map(m => s"${path.toString}: ${m.matched}")
    }.sorted

    assertEquals(violations, Nil)

  test("Postgres read models avoid positional tuple read mappings"):
    val checked = List(matchListReadModel, seriesComparisonReadModel)
    val violations = checked.flatMap { path =>
      val text = read(path)
      List(
        Option.when(text.contains("Read[("))(s"${path.toString}: Read[("),
        Option.when(text.contains(".query[("))(s"${path.toString}: .query[("),
      ).flatten
    }

    assertEquals(violations, Nil)

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: java.nio.file.Path): String =
    Files.readString(path, StandardCharsets.UTF_8)

end PostgresRepositoryArchitectureSpec
