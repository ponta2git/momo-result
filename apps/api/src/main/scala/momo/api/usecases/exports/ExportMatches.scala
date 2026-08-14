package momo.api.usecases.exports

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MapMaster,
  MatchExportFile,
  MatchExportFormat,
  MatchExportRow,
  MatchExportScope,
  Member,
  PlayerResult,
  SeasonMaster
}
import momo.api.errors.AppError
import momo.api.repositories.{
  MapMastersRepository,
  MatchExportsRepository,
  MembersRepository,
  SeasonMastersRepository
}

final class ExportMatches[F[_]: Monad](
    matchExports: MatchExportsRepository[F],
    members: MembersRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
    limits: ExportMatches.Limits,
):
  import ExportMatches.*

  def run(
      format: MatchExportFormat,
      scope: MatchExportScope,
  ): F[Either[AppError, MatchExportFile]] =
    for
      selected <- matchExports.project(scopeToSelection(scope))
      result <- scope match
        case MatchExportScope.Match(id) if selected.isEmpty =>
          AppError.NotFound("match", id.value).asLeft[MatchExportFile].pure[F]
        case _ => runBounded(format, scope, selected)
    yield result

  private def runBounded(
      format: MatchExportFormat,
      scope: MatchExportScope,
      selected: List[MatchExportsRepository.ProjectedMatch],
  ): F[Either[AppError, MatchExportFile]] = selectedRowsUpperBound(selected) match
    case Some(rowCount) => rowLimitError(rowCount).asLeft[MatchExportFile].pure[F]
    case None =>
      for
        memberRows <- members.list
        mapRows <- mapMasters.list(None)
        seasonRows <- seasonMasters.list(None)
      yield buildRows(
        selected = selected,
        members = memberRows,
        maps = mapRows,
        seasons = seasonRows,
      ).flatMap { rows =>
        for
          _ <- ensureRowLimit(rows.length)
          rendered = MatchExportRenderer.render(format, rows)
          _ <- ensureByteLimit(rendered.sizeBytes)
        yield MatchExportFile(
          fileName = s"momo-results-${scope.filePart}.${format.extension}",
          contentType = format.contentType,
          body = rendered.body,
        )
      }

  private def scopeToSelection(scope: MatchExportScope): MatchExportsRepository.Selection =
    val selected = scope match
      case MatchExportScope.All => MatchExportsRepository.Selection(limit = selectedMatchLimit)
      case MatchExportScope.Season(id) =>
        MatchExportsRepository.Selection(seasonMasterId = Some(id), limit = selectedMatchLimit)
      case MatchExportScope.HeldEvent(id) =>
        MatchExportsRepository.Selection(heldEventId = Some(id), limit = selectedMatchLimit)
      case MatchExportScope.Match(id) =>
        MatchExportsRepository.Selection(matchId = Some(id), limit = selectedMatchLimit)
    selected

  private def buildRows(
      selected: List[MatchExportsRepository.ProjectedMatch],
      members: List[Member],
      maps: List[MapMaster],
      seasons: List[SeasonMaster],
  ): Either[AppError, List[MatchExportRow]] =
    val memberNames = members.map(m => m.id -> m.displayName).toMap
    val mapNames = maps.map(m => m.id -> m.name).toMap
    val seasonNames = seasons.map(s => s.id -> s.name).toMap

    selected.traverse { record =>
      for
        seasonName <- lookup(seasonNames, record.seasonMasterId, "season")
        mapName <- lookup(mapNames, record.mapMasterId, "map")
        ownerName <- lookup(memberNames, record.ownerMemberId, "member")
        rows <- record.players.byPlayOrder.traverse { player =>
          playerRow(record, player, memberNames, seasonName, ownerName, mapName)
        }
      yield rows
    }.map(_.flatten)

  private def playerRow(
      record: MatchExportsRepository.ProjectedMatch,
      player: PlayerResult,
      memberNames: Map[MemberId, String],
      seasonName: String,
      ownerName: String,
      mapName: String,
  ): Either[AppError, MatchExportRow] = lookup(memberNames, player.memberId, "member")
    .map { playerName =>
      MatchExportRow(
        seasonName = seasonName,
        seasonNo = record.seasonSequence,
        ownerName = ownerName,
        mapName = mapName,
        playedAt = record.playedAt,
        gameTitleMatchNo = record.gameTitleSequence,
        playOrder = player.playOrder.value,
        playerName = playerName,
        rank = player.rank.value,
        totalAssetsManYen = player.totalAssetsManYen.value,
        revenueManYen = player.revenueManYen.value,
        incidents = player.incidents,
      )
    }

  private def lookup[A, Id](values: Map[Id, A], id: Id, label: String): Either[AppError, A] = values
    .get(id).toRight(AppError.Internal(s"Export $label lookup failed for id: $id"))

  private def selectedMatchLimit: Int =
    ((limits.maxRows + MatchRowsPerMatch - 1) / MatchRowsPerMatch) + 1

  private def selectedRowsUpperBound(
      selected: List[MatchExportsRepository.ProjectedMatch]
  ): Option[Int] = Option
    .when(selected.length >= selectedMatchLimit)(selected.length * MatchRowsPerMatch)

  private def ensureRowLimit(rowCount: Int): Either[AppError, Unit] = Either
    .cond(rowCount <= limits.maxRows, (), rowLimitError(rowCount))

  private def ensureByteLimit(bodyBytes: Long): Either[AppError, Unit] =
    Either.cond(
      bodyBytes <= limits.maxBytes,
      (),
      AppError.PayloadTooLarge(
        s"Match export has $bodyBytes bytes, exceeding the configured limit of ${limits
            .maxBytes} bytes. Narrow the export scope."
      ),
    )

  private def rowLimitError(rowCount: Int): AppError = AppError
    .PayloadTooLarge(s"Match export has $rowCount rows, exceeding the configured limit of ${limits
        .maxRows} rows. Narrow the export scope.")

object ExportMatches:
  private val MatchRowsPerMatch: Int = 4

  final case class Limits(maxRows: Int, maxBytes: Long)
