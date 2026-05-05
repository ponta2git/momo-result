package momo.api.usecases

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.*
import momo.api.domain.{
  MapMaster, MatchExportFile, MatchExportFormat, MatchExportRow, MatchExportScope, MatchRecord,
  Member, PlayerResult, SeasonMaster,
}
import momo.api.errors.AppError
import momo.api.repositories.{
  MapMastersRepository, MatchesRepository, MembersRepository, SeasonMastersRepository,
}

final class ExportMatches[F[_]: Monad](
    matches: MatchesRepository[F],
    members: MembersRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
):
  def run(
      formatValue: String,
      seasonMasterId: Option[SeasonMasterId],
      heldEventId: Option[HeldEventId],
      matchId: Option[MatchId],
  ): F[Either[AppError, MatchExportFile]] =
    (parseFormat(formatValue), parseScope(seasonMasterId, heldEventId, matchId)).tupled match
      case Left(error) => error.asLeft[MatchExportFile].pure[F]
      case Right((format, scope)) => build(format, scope)

  private def build(
      format: MatchExportFormat,
      scope: MatchExportScope,
  ): F[Either[AppError, MatchExportFile]] =
    for
      selected <- matches.list(scopeToFilter(scope))
      sequenceMatches <- loadSequenceMatches(scope, selected)
      memberRows <- members.list
      mapRows <- mapMasters.list(None)
      seasonRows <- seasonMasters.list(None)
    yield scope match
      case MatchExportScope.Match(id) if selected.isEmpty =>
        AppError.NotFound("match", id.value).asLeft
      case _ => buildRows(
          selected = selected,
          allMatches = sequenceMatches,
          members = memberRows,
          maps = mapRows,
          seasons = seasonRows,
        ).map { rows =>
          MatchExportFile(
            fileName = s"momo-results-${scope.filePart}.${format.extension}",
            contentType = format.contentType,
            body = MatchExportSerializer.render(format, rows),
          )
        }

  private def scopeToFilter(scope: MatchExportScope): MatchesRepository.ListFilter = scope match
    case MatchExportScope.All => MatchesRepository.ListFilter()
    case MatchExportScope.Season(id) => MatchesRepository.ListFilter(seasonMasterId = Some(id))
    case MatchExportScope.HeldEvent(id) => MatchesRepository.ListFilter(heldEventId = Some(id))
    case MatchExportScope.Match(id) => MatchesRepository.ListFilter(matchId = Some(id))

  /**
   * The CSV columns シーズンNo. (sequence within season) and 対戦No. (sequence within game title)
   * are computed across the **entire** dataset for the relevant season / game title, not just the
   * selected slice. For narrow scopes we therefore fan out targeted queries by season and game
   * title instead of pulling the full table — the result is byte-identical to the previous
   * full-scan implementation, but DB load stays bounded.
   */
  private def loadSequenceMatches(
      scope: MatchExportScope,
      selected: List[MatchRecord],
  ): F[List[MatchRecord]] = scope match
    case MatchExportScope.All => selected.pure[F]
    case _ =>
      val seasonIds = selected.map(_.seasonMasterId).distinct
      val gameTitleIds = selected.map(_.gameTitleId).distinct
      for
        bySeason <- seasonIds
          .flatTraverse(id => matches.list(MatchesRepository.ListFilter(seasonMasterId = Some(id))))
        byGame <- gameTitleIds
          .flatTraverse(id => matches.list(MatchesRepository.ListFilter(gameTitleId = Some(id))))
      yield (bySeason ++ byGame).distinctBy(_.id)

  private def parseFormat(value: String): Either[AppError, MatchExportFormat] = MatchExportFormat
    .fromWire(value).toRight(AppError.ValidationFailed("format must be one of: csv, tsv."))

  private def parseScope(
      seasonMasterId: Option[SeasonMasterId],
      heldEventId: Option[HeldEventId],
      matchId: Option[MatchId],
  ): Either[AppError, MatchExportScope] =
    val scopes = List(
      seasonMasterId.filter(_.value.trim.nonEmpty).map(MatchExportScope.Season(_)),
      heldEventId.filter(_.value.trim.nonEmpty).map(MatchExportScope.HeldEvent(_)),
      matchId.filter(_.value.trim.nonEmpty).map(MatchExportScope.Match(_)),
    ).flatten
    scopes match
      case Nil => Right(MatchExportScope.All)
      case one :: Nil => Right(one)
      case _ => Left(AppError.ValidationFailed(
          "Specify at most one export scope: seasonMasterId, heldEventId, or matchId."
        ))

  private def buildRows(
      selected: List[MatchRecord],
      allMatches: List[MatchRecord],
      members: List[Member],
      maps: List[MapMaster],
      seasons: List[SeasonMaster],
  ): Either[AppError, List[MatchExportRow]] =
    val memberNames = members.map(m => m.id -> m.displayName).toMap
    val mapNames = maps.map(m => m.id -> m.name).toMap
    val seasonNames = seasons.map(s => s.id -> s.name).toMap
    val seasonNoByMatch = sequenceBy(allMatches)(_.seasonMasterId)
    val gameNoByMatch = sequenceBy(allMatches)(_.gameTitleId)

    selected.sortWith(compareMatches).traverse { record =>
      for
        seasonName <- lookup(seasonNames, record.seasonMasterId, "season")
        mapName <- lookup(mapNames, record.mapMasterId, "map")
        ownerName <- lookup(memberNames, record.ownerMemberId, "member")
        seasonNo <- lookup(seasonNoByMatch, record.id, "season sequence")
        gameNo <- lookup(gameNoByMatch, record.id, "game title sequence")
        rows <- record.players.byPlayOrder.traverse { player =>
          playerRow(record, player, memberNames, seasonName, seasonNo, ownerName, mapName, gameNo)
        }
      yield rows
    }.map(_.flatten)

  private def playerRow(
      record: MatchRecord,
      player: PlayerResult,
      memberNames: Map[MemberId, String],
      seasonName: String,
      seasonNo: Int,
      ownerName: String,
      mapName: String,
      gameNo: Int,
  ): Either[AppError, MatchExportRow] = lookup(memberNames, player.memberId, "member")
    .map { playerName =>
      MatchExportRow(
        seasonName = seasonName,
        seasonNo = seasonNo,
        ownerName = ownerName,
        mapName = mapName,
        playedAt = record.playedAt,
        gameTitleMatchNo = gameNo,
        playOrder = player.playOrder,
        playerName = playerName,
        rank = player.rank,
        totalAssetsManYen = player.totalAssetsManYen,
        revenueManYen = player.revenueManYen,
        incidents = player.incidents,
      )
    }

  private def lookup[A, Id](values: Map[Id, A], id: Id, label: String): Either[AppError, A] = values
    .get(id).toRight(AppError.Internal(s"Export $label lookup failed for id: $id"))

  private def sequenceBy[Id](records: List[MatchRecord])(
      key: MatchRecord => Id
  ): Map[MatchId, Int] =
    val sorted = records.sortWith(compareMatches)
    sorted.groupMap(key)(identity).values
      .flatMap(_.zipWithIndex.map { case (record, index) => record.id -> (index + 1) }).toMap

  private def compareMatches(a: MatchRecord, b: MatchRecord): Boolean =
    val ak = (a.playedAt.toEpochMilli, a.heldEventId.value, a.matchNoInEvent, a.id.value)
    val bk = (b.playedAt.toEpochMilli, b.heldEventId.value, b.matchNoInEvent, b.id.value)
    ak < bk
