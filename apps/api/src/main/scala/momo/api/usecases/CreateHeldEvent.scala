package momo.api.usecases

import java.time.Instant
import java.time.format.DateTimeParseException

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.either.*

import momo.api.domain.HeldEvent
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.HeldEventsRepository

final case class CreateHeldEventCommand(heldAt: String)

final class CreateHeldEvent[F[_]: MonadThrow](events: HeldEventsRepository[F], nextId: F[String]):
  def run(command: CreateHeldEventCommand): F[Either[AppError, HeldEvent]] = CreateHeldEvent
    .parseHeldAt(command.heldAt) match
    case Left(error) => MonadThrow[F].pure(Left(error))
    case Right(instant) => (for
        id <- EitherT.liftF(nextId)
        event = HeldEvent(id = HeldEventId(id), heldAt = instant)
        _ <- EitherT.liftF(events.create(event))
      yield event).value

object CreateHeldEvent:
  private[usecases] def parseHeldAt(value: String): Either[AppError, Instant] = Either
    .catchOnly[DateTimeParseException](Instant.parse(value))
    .leftMap(_ => AppError.ValidationFailed("heldAt must be ISO8601 instant."))
