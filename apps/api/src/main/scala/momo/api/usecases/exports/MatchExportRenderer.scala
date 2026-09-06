package momo.api.usecases.exports

import java.time.ZoneId
import java.time.format.DateTimeFormatter

import scala.annotation.tailrec

import momo.api.domain.{MatchExportFormat, MatchExportRow}
import momo.api.encoding.Utf8

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

  /** Stops at the UTF-8 limit before appending an oversized field or constructing the final body. */
  def render(
      format: MatchExportFormat,
      rows: List[MatchExportRow],
      maximumBytes: Long,
  ): Option[Rendered] =
    val output = new StringBuilder
    val renderField: String => String = format match
      case MatchExportFormat.Csv => csvField
      case MatchExportFormat.Tsv => tsvField
    val lines = Iterator.single(Header) ++ rows.iterator.map(fields)

    @tailrec
    def appendLines(written: Long): Option[Rendered] =
      if !lines.hasNext then Some(Rendered(output.result(), written))
      else
        appendLine(
          output,
          format.delimiter,
          renderField,
          lines.next(),
          maximumBytes - written
        ) match
          case None => None
          case Some(size) => appendLines(written + size)

    appendLines(0L)

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
      maximumBytes: Long,
  ): Option[Long] =
    @tailrec
    def appendFields(index: Int, written: Long): Option[Long] =
      if index == fields.length then
        if maximumBytes - written < 2 then None
        else
          output.append("\r\n")
          Some(written + 2)
      else
        val field = renderField(fields(index))
        val separatorSize = if index > 0 then Utf8.length(delimiter) else 0L
        val size = separatorSize + Utf8.length(field)
        if size > maximumBytes - written then None
        else
          if index > 0 then output.append(delimiter)
          output.append(field)
          appendFields(index + 1, written + size)

    appendFields(0, 0L)

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
