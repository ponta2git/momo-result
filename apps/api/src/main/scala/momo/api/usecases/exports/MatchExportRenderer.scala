package momo.api.usecases.exports

import java.time.ZoneId
import java.time.format.DateTimeFormatter

import scala.annotation.tailrec

import momo.api.domain.{MatchExportFormat, MatchExportRow}

object MatchExportRenderer:
  private val Jst = ZoneId.of("Asia/Tokyo")
  private val DateFormatter = DateTimeFormatter.ISO_LOCAL_DATE
  private val Header: Array[String] = Array(
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

  final case class Rendered(body: String, sizeBytes: Long)

  /** Renders directly into the final builder and reports its UTF-8 size without a second body. */
  def render(format: MatchExportFormat, rows: List[MatchExportRow]): Rendered =
    val output = new StringBuilder
    val renderField: String => String = format match
      case MatchExportFormat.Csv => csvField
      case MatchExportFormat.Tsv => tsvField
    appendLine(output, format.delimiter, renderField, Header)
    rows.foreach(row => appendLine(output, format.delimiter, renderField, fields(row)))
    val body = output.result()
    Rendered(body, utf8Size(body))

  private def fields(row: MatchExportRow): Array[String] = Array(
    spreadsheetSafeText(row.seasonName),
    row.seasonNo.toString,
    spreadsheetSafeText(row.ownerName),
    spreadsheetSafeText(row.mapName),
    DateFormatter.format(row.playedAt.atZone(Jst).toLocalDate),
    row.gameTitleMatchNo.toString,
    row.playOrder.toString,
    spreadsheetSafeText(row.playerName),
    row.rank.toString,
    row.totalAssetsManYen.toString,
    row.revenueManYen.toString,
    row.incidents.destination.value.toString,
    row.incidents.plusStation.value.toString,
    row.incidents.minusStation.value.toString,
    row.incidents.cardStation.value.toString,
    row.incidents.cardShop.value.toString,
    row.incidents.suriNoGinji.value.toString,
  )

  private def appendLine(
      output: StringBuilder,
      delimiter: String,
      renderField: String => String,
      fields: Array[String],
  ): Unit =
    @tailrec
    def appendFields(index: Int): Unit =
      if index < fields.length then
        if index > 0 then output.append(delimiter)
        output.append(renderField(fields(index)))
        appendFields(index + 1)

    appendFields(0)
    output.append("\r\n")

  private def spreadsheetSafeText(value: String): String =
    val dangerousFirst = value.headOption.exists(ch => ch == '\t' || ch == '\r' || ch == '\n')
    val afterLeadingBlanks = value.dropWhile(ch => ch == ' ' || ch == '\t')
    val dangerousFormula = afterLeadingBlanks.headOption
      .exists(ch => ch == '=' || ch == '+' || ch == '-' || ch == '@')
    if dangerousFirst || dangerousFormula then s"'$value" else value

  private def csvField(value: String): String =
    val mustQuote = value.exists(ch => ch == ',' || ch == '"' || ch == '\r' || ch == '\n')
    if mustQuote then s""""${value.replace("\"", "\"\"")}"""" else value

  private def tsvField(value: String): String =
    val requiresEscaping = value.exists(ch => ch == '\\' || ch == '\t' || ch == '\r' || ch == '\n')
    if !requiresEscaping then value
    else
      value.flatMap {
        case '\\' => "\\\\"
        case '\t' => "\\t"
        case '\r' => "\\n"
        case '\n' => "\\n"
        case ch => ch.toString
      }

  private def utf8Size(value: String): Long =
    @tailrec
    def loop(index: Int, bytes: Long): Long =
      if index >= value.length then bytes
      else
        val codeUnit = value.charAt(index)
        if codeUnit <= 0x7f then loop(index + 1, bytes + 1)
        else if codeUnit <= 0x7ff then loop(index + 1, bytes + 2)
        else if Character.isHighSurrogate(codeUnit) && index + 1 < value.length &&
          Character
            .isLowSurrogate(value.charAt(index + 1))
        then loop(index + 2, bytes + 4)
        else if Character.isSurrogate(codeUnit) then loop(index + 1, bytes + 1)
        else loop(index + 1, bytes + 3)

    loop(index = 0, bytes = 0L)
