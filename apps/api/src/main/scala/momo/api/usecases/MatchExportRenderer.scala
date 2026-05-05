package momo.api.usecases

import java.time.ZoneId
import java.time.format.DateTimeFormatter

import momo.api.domain.{MatchExportFormat, MatchExportRow}

object MatchExportRenderer:
  private val Jst = ZoneId.of("Asia/Tokyo")
  private val DateFormatter = DateTimeFormatter.ISO_LOCAL_DATE
  val Header: List[String] = List(
    "シーズン",
    "シーズンNo.",
    "オーナー",
    "マップ",
    "対戦日",
    "対戦No.",
    "プレー順",
    "プレーヤー名",
    "順位",
    "総資産",
    "収益",
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次",
  )

  def render(format: MatchExportFormat, rows: List[MatchExportRow]): String =
    val allLines = Header :: rows.map(fields)
    allLines.map(line => renderLine(format, line)).mkString("\r\n") + "\r\n"

  private def fields(row: MatchExportRow): List[String] = List(
    row.seasonName,
    row.seasonNo.toString,
    row.ownerName,
    row.mapName,
    DateFormatter.format(row.playedAt.atZone(Jst).toLocalDate),
    row.gameTitleMatchNo.toString,
    row.playOrder.toString,
    row.playerName,
    row.rank.toString,
    row.totalAssetsManYen.toString,
    row.revenueManYen.toString,
    row.incidents.destination.toString,
    row.incidents.plusStation.toString,
    row.incidents.minusStation.toString,
    row.incidents.cardStation.toString,
    row.incidents.cardShop.toString,
    row.incidents.suriNoGinji.toString,
  )

  private def renderLine(format: MatchExportFormat, fields: List[String]): String = format match
    case MatchExportFormat.Csv => fields.map(csvField).mkString(format.delimiter)
    case MatchExportFormat.Tsv => fields.map(tsvField).mkString(format.delimiter)

  private def csvField(value: String): String =
    val mustQuote = value.exists(ch => ch == ',' || ch == '"' || ch == '\r' || ch == '\n')
    if mustQuote then s""""${value.replace("\"", "\"\"")}"""" else value

  private def tsvField(value: String): String = value.flatMap {
    case '\\' => "\\\\"
    case '\t' => "\\t"
    case '\r' => "\\n"
    case '\n' => "\\n"
    case ch => ch.toString
  }
