package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class PostgresRepositoryArchitectureSpec extends FunSuite:
  private val postgresDir = Paths.get("src/main/scala/momo/api/adapters/postgres")

  test("synchronous Scala series analysis sources are absent"):
    val engineRoot = Paths.get("src/main/scala/momo/api/usecases/seriescomparison")
    assert(!Files.exists(engineRoot) || scalaFiles(engineRoot).isEmpty)
    assert(!Files.exists(
      Paths.get("src/main/scala/momo/api/adapters/postgres/PostgresSeriesComparisonReadModel.scala")
    ))
    assert(!Files.exists(
      Paths.get("src/main/scala/momo/api/repositories/SeriesComparisonReadModel.scala")
    ))

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
