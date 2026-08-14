package momo.api.usecases.matches

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64

import scala.util.Try

import cats.syntax.all.*
import io.circe.syntax.*
import io.circe.{parser, Codec}

import momo.api.domain.ids.*
import momo.api.domain.{MatchListKindFilter, MatchListSort, MatchListStatusFilter}
import momo.api.errors.AppError
import momo.api.repositories.MatchListReadModel

private[matches] object MatchListCursorCodec:
  private val Version = 1
  private val MaxEncodedLength = 4096
  private val MaxDecodedLength = 3072
  private val MaxTextLength = 256
  private val MinimumTimestamp = Instant.parse("0001-01-01T00:00:00Z")
  private val MaximumTimestampExclusive = Instant.parse("+10000-01-01T00:00:00Z")
  private val Invalid = AppError.BadRequest("cursor is invalid for current match list filters.")

  final case class Scope(
      accountId: AccountId,
      heldEventId: Option[HeldEventId],
      gameTitleId: Option[GameTitleId],
      seasonMasterId: Option[SeasonMasterId],
      status: MatchListStatusFilter,
      kind: MatchListKindFilter,
      sort: MatchListSort,
      pageSize: Int,
  ) derives CanEqual

  private final case class WireScope(
      accountId: String,
      heldEventId: Option[String],
      gameTitleId: Option[String],
      seasonMasterId: Option[String],
      status: String,
      kind: String,
      sort: String,
      pageSize: Int,
  ) derives Codec.AsObject

  private final case class WirePosition(
      statusPriority: Int,
      updatedAt: String,
      heldAt: String,
      matchNoIsNull: Boolean,
      matchNoSort: Int,
      kind: String,
      id: String,
  ) derives Codec.AsObject

  private final case class WireCursor(
      version: Int,
      scope: WireScope,
      direction: String,
      page: Int,
      totalItems: Int,
      position: Option[WirePosition],
  ) derives Codec.AsObject

  def encode(scope: Scope, cursor: MatchListReadModel.Cursor): String =
    val wire = WireCursor(
      version = Version,
      scope = WireScope(
        accountId = scope.accountId.value,
        heldEventId = scope.heldEventId.map(_.value),
        gameTitleId = scope.gameTitleId.map(_.value),
        seasonMasterId = scope.seasonMasterId.map(_.value),
        status = scope.status.wire,
        kind = scope.kind.wire,
        sort = scope.sort.wire,
        pageSize = scope.pageSize,
      ),
      direction = cursor.direction match
        case MatchListReadModel.CursorDirection.After => "after"
        case MatchListReadModel.CursorDirection.Before => "before",
      page = cursor.page,
      totalItems = cursor.totalItems,
      position = cursor.position.map(position =>
        WirePosition(
          statusPriority = position.statusPriority,
          updatedAt = position.updatedAt.truncatedTo(ChronoUnit.MICROS).toString,
          heldAt = position.heldAt.truncatedTo(ChronoUnit.MICROS).toString,
          matchNoIsNull = position.matchNoIsNull,
          matchNoSort = position.matchNoSort,
          kind = position.kind,
          id = position.id,
        )
      ),
    )
    Base64.getUrlEncoder.withoutPadding.encodeToString(
      wire.asJson.noSpaces.getBytes(StandardCharsets.UTF_8)
    )

  def decode(
      encoded: String,
      expectedScope: Scope,
  ): Either[AppError, MatchListReadModel.Cursor] =
    val decoded =
      for
        _ <- Either.cond(
          encoded.nonEmpty && encoded.length <= MaxEncodedLength,
          (),
          (),
        )
        bytes <- Try(Base64.getUrlDecoder.decode(encoded)).toEither.leftMap(_ => ())
        _ <- Either.cond(bytes.length <= MaxDecodedLength, (), ())
        json <- parser.parse(new String(bytes, StandardCharsets.UTF_8)).leftMap(_ => ())
        wire <- json.as[WireCursor].leftMap(_ => ())
        _ <- Either.cond(wire.version == Version, (), ())
        scope <- decodeScope(wire.scope)
        _ <- Either.cond(scope == expectedScope, (), ())
        direction <- wire.direction match
          case "after" => Right(MatchListReadModel.CursorDirection.After)
          case "before" => Right(MatchListReadModel.CursorDirection.Before)
          case _ => Left(())
        position <- wire.position.traverse(decodePosition)
        cursor = MatchListReadModel.Cursor(
          direction = direction,
          page = wire.page,
          totalItems = wire.totalItems,
          position = position,
        )
        _ <- validateCursor(cursor, expectedScope.pageSize)
      yield cursor
    decoded.leftMap(_ => Invalid)

  private def decodeScope(wire: WireScope): Either[Unit, Scope] =
    for
      accountId <- parseId(AccountId.fromString)(wire.accountId)
      heldEventId <- wire.heldEventId.traverse(parseId(HeldEventId.fromString))
      gameTitleId <- wire.gameTitleId.traverse(parseId(GameTitleId.fromString))
      seasonMasterId <- wire.seasonMasterId.traverse(parseId(SeasonMasterId.fromString))
      status <- MatchListStatusFilter.fromWire(wire.status).toRight(())
      kind <- MatchListKindFilter.fromWire(wire.kind).toRight(())
      sort <- MatchListSort.fromWire(wire.sort).toRight(())
      // The expected scope was constructed only after ListPagination policy validation. Exact scope
      // equality below is the single source of truth for the upper bound as that policy evolves.
      _ <- Either.cond(wire.pageSize >= 1, (), ())
    yield Scope(
      accountId,
      heldEventId,
      gameTitleId,
      seasonMasterId,
      status,
      kind,
      sort,
      wire.pageSize
    )

  private def decodePosition(wire: WirePosition): Either[Unit, MatchListReadModel.CursorPosition] =
    for
      _ <- Either.cond(wire.statusPriority >= 0 && wire.statusPriority <= 5, (), ())
      updatedAt <- parseTimestamp(wire.updatedAt)
      heldAt <- parseTimestamp(wire.heldAt)
      _ <- Either.cond(
        if wire.matchNoIsNull then wire.matchNoSort == Int.MaxValue
        else wire.matchNoSort >= 1,
        (),
        (),
      )
      _ <- Either.cond(wire.kind == "match" || wire.kind == "match_draft", (), ())
      id <- wire.kind match
        case "match" => parseId(MatchId.fromString)(wire.id).map(_.value)
        case "match_draft" => parseId(MatchDraftId.fromString)(wire.id).map(_.value)
        case _ => Left(())
    yield MatchListReadModel.CursorPosition(
      statusPriority = wire.statusPriority,
      updatedAt = updatedAt,
      heldAt = heldAt,
      matchNoIsNull = wire.matchNoIsNull,
      matchNoSort = wire.matchNoSort,
      kind = wire.kind,
      id = id,
    )

  private def validateCursor(cursor: MatchListReadModel.Cursor, pageSize: Int): Either[Unit, Unit] =
    val totalPages =
      if cursor.totalItems <= 0 then 0
      else ((cursor.totalItems.toLong + pageSize.toLong - 1L) / pageSize.toLong).toInt
    val common = cursor.totalItems > 0 && cursor.page >= 1 && cursor.page <= totalPages
    val shape = cursor.direction match
      case MatchListReadModel.CursorDirection.After => cursor.position.nonEmpty && cursor.page >= 2
      case MatchListReadModel.CursorDirection.Before => cursor.position.nonEmpty ||
        (cursor.page == totalPages && cursor.page >= 2)
    Either.cond(common && shape, (), ())

  private def parseId[A](parse: String => Either[String, A])(value: String): Either[Unit, A] =
    validateText(value).flatMap(parse(_).leftMap(_ => ()))

  private def parseTimestamp(value: String): Either[Unit, Instant] =
    Try(Instant.parse(value)).toEither
      .leftMap(_ => ()).flatMap(timestamp =>
        Either.cond(
          !timestamp.isBefore(MinimumTimestamp) &&
            timestamp.isBefore(MaximumTimestampExclusive) &&
            timestamp.getNano % 1000 == 0,
          timestamp,
          (),
        )
      )

  private def validateText(value: String): Either[Unit, String] = Either.cond(
    value.nonEmpty && value.length <= MaxTextLength && !value.exists(Character.isISOControl),
    value,
    (),
  )
end MatchListCursorCodec
