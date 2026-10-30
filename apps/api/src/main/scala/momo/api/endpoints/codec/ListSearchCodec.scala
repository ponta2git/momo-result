package momo.api.endpoints.codec

import java.time.LocalDate

import scala.util.Try

import cats.syntax.all.*

import momo.api.domain.MatchListSearchCriteria
import momo.api.errors.AppError

/** Shared wire rules for confirmed-match and held-event search. */
private[codec] object ListSearchCodec:
  private val IsoDate = "[0-9]{4}-[0-9]{2}-[0-9]{2}".r

  def parseDateRange(
      from: Option[String],
      to: Option[String],
  ): Either[AppError, (Option[LocalDate], Option[LocalDate])] =
    for
      start <- from.traverse(parseDate("from", _))
      end <- to.traverse(parseDate("to", _))
      _ <- Either.cond(
        (start, end).tupled.forall { case (from, to) => !from.isAfter(to) },
        (),
        AppError.ValidationFailed("from must be on or before to."),
      )
    yield (start, end)

  private def parseDate(field: String, raw: String): Either[AppError, LocalDate] =
    val invalid = AppError.ValidationFailed(s"$field must be a date in YYYY-MM-DD format.")
    if IsoDate.matches(raw) then Try(LocalDate.parse(raw)).toEither.leftMap(_ => invalid)
    else Left(invalid)

  def parseNoteQuery(raw: Option[String]): Either[AppError, Option[String]] =
    raw.map(_.dropWhile(isQueryWhitespace).reverse.dropWhile(isQueryWhitespace).reverse)
      .filter(_.nonEmpty).traverse { query =>
        if query.codePointCount(0, query.length) > MatchListSearchCriteria.NoteQueryMaxCodePoints
        then
          Left(AppError.ValidationFailed(
            s"q must be at most ${MatchListSearchCriteria.NoteQueryMaxCodePoints} characters."
          ))
        else if query.exists(Character.isISOControl) then
          Left(AppError.ValidationFailed("q must not contain control characters."))
        else Right(query)
      }

  // Match the browser's String.trim, including full-width spaces, NBSP and BOM.
  private def isQueryWhitespace(character: Char): Boolean =
    Character.isSpaceChar(character) || (character >= '\t' && character <= '\r') ||
      character == '\ufeff'
