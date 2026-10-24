package momo.api.tools

import java.util.UUID

import io.circe.Json
import munit.FunSuite

final class InitialAchievementInputSuite extends FunSuite:
  private val ids = (1 to 31).map(index => UUID(0L, index.toLong)).toList
  private val manifest = Json.obj(
    "formatVersion" -> Json.fromInt(1),
    "items" -> Json.fromValues(ids.zipWithIndex.map { case (id, index) =>
      Json.obj(
        "sourceRow" -> Json.fromInt(index + 1),
        "id" -> Json.fromString(id.toString),
        "fixedKey" -> Json.fromString(s"fixture-${(index + 1).toString}"),
        "name" -> Json.fromString(s"実績${(index + 1).toString}"),
        "notes" -> Json.fromString(""),
        "stars" -> Json.fromInt(2),
        "scope" -> Json.fromString("common"),
        "ruleKind" -> Json.fromString("manual"),
        "threshold" -> Json.Null,
      )
    }),
  ).noSpaces
  private val mapping = Json.obj(
    "gameTitleId" -> Json.fromString("title"),
    "eastMapId" -> Json.fromString("east"),
    "westMapId" -> Json.fromString("west"),
    "accountId" -> Json.fromString("actor"),
    "players" -> Json.fromValues(List("A", "B", "C", "D").map(name =>
      Json.obj("column" -> Json.fromString(name), "memberId" -> Json.fromString(s"member-$name"))
    )),
  ).noSpaces
  private val source =
    (List("No.\tカテゴリ\t内容\t難易度\tA\tB\tC\tD\t備考") ++
      (1 to 31).map { index =>
        List(
          index.toString,
          "共通",
          s"実績${index.toString}",
          "★★",
          if index == 1 then "達成！" else "",
          if index == 2 then "達成？" else "",
          "",
          "",
          ""
        ).mkString("\t")
      }).mkString("\n")

  test("initial import keeps explicit unknown-date evidence and stable manifest identities") {
    val prepared = InitialAchievementInput.prepare(manifest, mapping, source).toOption.get
    assertEquals(prepared.command.items.map(_.id), ids)
    assertEquals(prepared.confirmed, 1)
    assertEquals(prepared.unconfirmed, 1)
    assertEquals(
      prepared.command.claims.map(c => (c.achievementId, c.state)),
      List((ids.head, "achieved"), (ids(1), "unconfirmed"))
    )
    assertEquals(prepared.sourceChecksum.length, 71)
  }

  test("mismatched player order cannot silently attribute achievements to another person") {
    val reordered = source.replace("\tA\tB\tC\tD\t", "\tB\tA\tC\tD\t")
    assertEquals(
      InitialAchievementInput.prepare(manifest, mapping, reordered).left.toOption,
      Some("TSV player columns do not match the explicit mapping order.")
    )
  }

  test("changed definitions and unexpected status marks reject the whole source") {
    assert(InitialAchievementInput.prepare(
      manifest,
      mapping,
      source.replace("実績1\t", "変更された条件\t")
    ).isLeft)
    assert(InitialAchievementInput.prepare(manifest, mapping, source.replace("達成？", "不明な印")).isLeft)
  }
