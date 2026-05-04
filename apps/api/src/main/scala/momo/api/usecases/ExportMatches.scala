package momo.api.usecases

import cats.Applicative
import cats.syntax.all.*

import momo.api.domain.{
  MapMaster, MatchExportFile, MatchExportFormat, MatchExportRow, MatchExportScope, MatchRecord,
  Member, PlayerResult, SeasonMaster,
}
import momo.api.errors.AppError
import momo.api.repositories.{
  MapMastersRepository, MatchesRepository, MembersRepository, SeasonMastersRepository,
}

final class ExportMatches[F[_]: Applicative](
    matches: MatchesRepository[F],
    members: MembersRepository[F],
    mapMasters: MapMastersRepository[F],
    seasonMasters: SeasonMastersRepository[F],
):
  def run(
      formatValue: String,
      seasonMasterId: Option[String],
      heldEventId: Option[String],
      matchId: Option[String],
  ): F[Either[AppError, MatchExportFile]] =
    (parseFormat(formatValue), parseScope(seasonMasterId, heldEventId, matchId)).tupled match
      case Left(error) => error.asLeft[MatchExportFile].pure[F]
      case Right((format, scope)) => build(format, scope)

  private def build(
      format: MatchExportFormat,
      scope: MatchExportScope,
  ): F[Either[AppError, MatchExportFile]] = (
    matches.list(MatchesRepository.ListFilter()),
    members.list,
    mapMasters.list(None),
    seasonMasters.list(None),
  ).mapN { (allMatches, memberRows, mapRows, seasonRows) =>
    val selected = filter(scope, allMatches)
    scope match
      case MatchExportScope.Match(id) if selected.isEmpty => AppError.NotFound("match", id).asLeft
      case _ => buildRows(
          selected = selected,
          allMatches = allMatches,
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
  }

  private def parseFormat(value: String): Either[AppError, MatchExportFormat] = MatchExportFormat
    .fromWire(value).toRight(AppError.ValidationFailed("format must be one of: csv, tsv."))

  private def parseScope(
      seasonMasterId: Option[String],
      heldEventId: Option[String],
      matchId: Option[String],
  ): Either[AppError, MatchExportScope] =
    val scopes = List(
      seasonMasterId.filter(_.trim.nonEmpty).map(id => MatchExportScope.Season(id.trim)),
      heldEventId.filter(_.trim.nonEmpty).map(id => MatchExportScope.HeldEvent(id.trim)),
      matchId.filter(_.trim.nonEmpty).map(id => MatchExportScope.Match(id.trim)),
    ).flatten
    scopes match
      case Nil => Right(MatchExportScope.All)
      case one :: Nil => Right(one)
      case _ => Left(AppError.ValidationFailed(
          "Specify at most one export scope: seasonMasterId, heldEventId, or matchId."
        ))

  private def filter(scope: MatchExportScope, records: List[MatchRecord]): List[MatchRecord] =
    scope match
      case MatchExportScope.All => records
      case MatchExportScope.Season(id) => records.filter(_.seasonMasterId == id)
      case MatchExportScope.HeldEvent(id) => records.filter(_.heldEventId == id)
      case MatchExportScope.Match(id) => records.filter(_.id == id)

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
        rows <- record.players.sortBy(_.playOrder).traverse { player =>
          playerRow(record, player, memberNames, seasonName, seasonNo, ownerName, mapName, gameNo)
        }
      yield rows
    }.map(_.flatten)

  private def playerRow(
      record: MatchRecord,
      player: PlayerResult,
      memberNames: Map[String, String],
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

  private def lookup[A](values: Map[String, A], id: String, label: String): Either[AppError, A] =
    values.get(id).toRight(AppError.Internal(s"Export $label lookup failed for id: $id"))

  private def sequenceBy(records: List[MatchRecord])(key: MatchRecord => String): Map[String, Int] =
    val sorted = records.sortWith(compareMatches)
    sorted.groupMap(key)(identity).values
      .flatMap(_.zipWithIndex.map { case (record, index) => record.id -> (index + 1) }).toMap

  private def compareMatches(a: MatchRecord, b: MatchRecord): Boolean =
    val ak = (a.playedAt.toEpochMilli, a.heldEventId, a.matchNoInEvent, a.id)
    val bk = (b.playedAt.toEpochMilli, b.heldEventId, b.matchNoInEvent, b.id)
    ak < bk
