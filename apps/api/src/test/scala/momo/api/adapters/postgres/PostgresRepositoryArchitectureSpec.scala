package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class PostgresRepositoryArchitectureSpec extends FunSuite:
  private val matchListReadModel =
    Paths.get("src/main/scala/momo/api/adapters/postgres/PostgresMatchListReadModel.scala")
  private val matchListSupport =
    Paths.get("src/main/scala/momo/api/adapters/postgres/PostgresMatchListSupport.scala")
  private val seriesComparisonReadModel = Paths.get(
    "src/main/scala/momo/api/adapters/postgres/PostgresSeriesComparisonReadModel.scala"
  )
  private val seriesComparisonRowSupport = Paths.get(
    "src/main/scala/momo/api/adapters/postgres/PostgresSeriesComparisonRowSupport.scala"
  )
  private val postgresDir = Paths.get("src/main/scala/momo/api/adapters/postgres")

  test("match list read-model maps DB rows through named fields"):
    val text = read(matchListReadModel)
    val supportText = read(matchListSupport)

    assert(text.contains("extends PostgresMatchListSupport"))
    assert(supportText.contains("protected final case class Row("))
    assert(!supportText.contains("private type Row = ("))
    assert(!supportText.contains("row._"))

  test("series comparison read-model keeps SQL row shape out of domain mapping"):
    val text = read(seriesComparisonReadModel)
    val supportText = read(seriesComparisonRowSupport)

    assert(text.contains("extends PostgresSeriesComparisonRowSupport"))
    assert(supportText.contains("protected final case class SeriesRow("))
    assert(supportText.contains("protected final case class ScopeOptionRow("))
    assert(supportText.contains("protected final case class PlayerRow("))
    assert(!supportText.contains("private type SeriesRow = ("))
    assert(!supportText.contains("private type ScopeOptionRow = ("))
    assert(!supportText.contains("private type PlayerRow = ("))
    assert(!supportText.contains("Read[("))
    assert(!supportText.contains(".query[("))
    assert(!supportText.contains("row._"))

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
    val violations = scalaFiles(postgresDir).flatMap { path =>
      val text = read(path)
      List(
        Option.when(text.contains("Read[("))(s"${path.toString}: Read[("),
        Option.when(text.contains(".query[("))(s"${path.toString}: .query[("),
        Option.when(text.contains("private type Row = ("))(
          s"${path.toString}: private type Row = ("
        ),
        Option.when(text.contains("private type MatchRow = ("))(
          s"${path.toString}: private type MatchRow = ("
        ),
        Option.when(raw"row\._[0-9]+".r.findFirstIn(text).isDefined)(s"${path.toString}: row._N"),
      ).flatten
    }

    assertEquals(violations, Nil)

  test("Postgres adapters do not build SQL identifier fragments from raw strings"):
    val violations = scalaFiles(postgresDir).flatMap { path =>
      Option.when(read(path).contains("Fragment.const"))(path.toString)
    }.sorted

    assertEquals(violations, Nil)

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: java.nio.file.Path): String =
    Files.readString(path, StandardCharsets.UTF_8)

end PostgresRepositoryArchitectureSpec
