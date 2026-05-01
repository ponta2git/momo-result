package momo.api.usecases

import java.time.Instant
import momo.api.domain.{IncidentCounts, MatchExportFormat, MatchExportRow}
import munit.FunSuite

final class MatchExportSerializerSpec extends FunSuite:
  private val row = MatchExportRow(
    seasonName = "春,大会",
    seasonNo = 2,
    ownerName = "ぽん\"た",
    mapName = "東日本編",
    playedAt = Instant.parse("2024-01-01T20:00:00Z"),
    gameTitleMatchNo = 7,
    playOrder = 1,
    playerName = "プレイヤー\nA",
    rank = 1,
    totalAssetsManYen = 12000,
    revenueManYen = 3000,
    incidents = IncidentCounts(
      destination = 5,
      plusStation = 2,
      minusStation = 1,
      cardStation = 3,
      cardShop = 4,
      suriNoGinji = 0,
    ),
  )

  test("CSV output fixes header order and escapes RFC4180 fields"):
    val out = MatchExportSerializer.render(MatchExportFormat.Csv, List(row))
    val lines = out.split("\r\n", -1).toList
    assertEquals(
      lines.head,
      "シーズン,シーズンNo.,オーナー,マップ,対戦日,対戦No.,プレー順,プレーヤー名,順位,総資産,収益,目的地,プラス駅,マイナス駅,カード駅,カード売り場,スリの銀次",
    )
    assertEquals(
      lines(1),
      "\"春,大会\",2,\"ぽん\"\"た\",東日本編,2024-01-02,7,1,\"プレイヤー\nA\",1,12000,3000,5,2,1,3,4,0",
    )
    assertEquals(lines.last, "")

  test("TSV output escapes structural tab and newline characters"):
    val out = MatchExportSerializer
      .render(MatchExportFormat.Tsv, List(row.copy(seasonName = "春\t大会", playerName = "A\\B\nC")))
    val lines = out.split("\r\n", -1).toList
    assertEquals(
      lines(1),
      "春\\t大会\t2\tぽん\"た\t東日本編\t2024-01-02\t7\t1\tA\\\\B\\nC\t1\t12000\t3000\t5\t2\t1\t3\t4\t0",
    )

  test("empty exports still include the header line"):
    val out = MatchExportSerializer.render(MatchExportFormat.Csv, Nil)
    assertEquals(
      out,
      "シーズン,シーズンNo.,オーナー,マップ,対戦日,対戦No.,プレー順,プレーヤー名,順位,総資産,収益,目的地,プラス駅,マイナス駅,カード駅,カード売り場,スリの銀次\r\n",
    )
