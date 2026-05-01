package momo.api.domain

import java.time.Instant

enum MatchExportFormat(
    val wire: String,
    val contentType: String,
    val extension: String,
    val delimiter: String,
) derives CanEqual:
  case Csv extends MatchExportFormat("csv", "text/csv; charset=utf-8", "csv", ",")
  case Tsv extends MatchExportFormat("tsv", "text/tab-separated-values; charset=utf-8", "tsv", "\t")

object MatchExportFormat:
  def fromWire(value: String): Option[MatchExportFormat] = value.trim.toLowerCase match
    case "csv" => Some(Csv)
    case "tsv" => Some(Tsv)
    case _ => None

enum MatchExportScope derives CanEqual:
  case All
  case Season(seasonMasterId: String)
  case HeldEvent(heldEventId: String)
  case Match(matchId: String)

  def filePart: String = this match
    case All => "all"
    case Season(id) => s"season-${MatchExportScope.safeFilePart(id)}"
    case HeldEvent(id) => s"held-event-${MatchExportScope.safeFilePart(id)}"
    case Match(id) => s"match-${MatchExportScope.safeFilePart(id)}"

object MatchExportScope:
  private def safeFilePart(value: String): String =
    val safe = value.replaceAll("[^A-Za-z0-9_.-]", "_").stripPrefix(".")
    safe match
      case "" => "scope"
      case _ => safe

final case class MatchExportRow(
    seasonName: String,
    seasonNo: Int,
    ownerName: String,
    mapName: String,
    playedAt: Instant,
    gameTitleMatchNo: Int,
    playOrder: Int,
    playerName: String,
    rank: Int,
    totalAssetsManYen: Int,
    revenueManYen: Int,
    incidents: IncidentCounts,
)

final case class MatchExportFile(fileName: String, contentType: String, body: String):
  def contentDisposition: String = s"attachment; filename=\"$fileName\""
