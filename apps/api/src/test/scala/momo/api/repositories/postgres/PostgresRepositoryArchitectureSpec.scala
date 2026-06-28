package momo.api.repositories.postgres

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}

import munit.FunSuite

final class PostgresRepositoryArchitectureSpec extends FunSuite:
  private val matchListReadModel =
    Paths.get("src/main/scala/momo/api/repositories/postgres/PostgresMatchListReadModel.scala")
  private val seriesComparisonReadModel = Paths.get(
    "src/main/scala/momo/api/repositories/postgres/PostgresSeriesComparisonReadModel.scala"
  )

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
    assert(!text.contains("row._"))

  private def read(path: java.nio.file.Path): String =
    Files.readString(path, StandardCharsets.UTF_8)

end PostgresRepositoryArchitectureSpec
