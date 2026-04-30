package momo.api.usecases

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*
import momo.api.domain.HeldEvent
import momo.api.errors.AppError
import momo.api.repositories.HeldEventsRepository

import java.time.Instant
import scala.util.Try

final case class CreateHeldEventCommand(heldAt: String)

final class CreateHeldEvent[F[_]: MonadThrow](
    events: HeldEventsRepository[F],
    nextId: F[String]
):
  def run(command: CreateHeldEventCommand): F[Either[AppError, HeldEvent]] =
    Try(Instant.parse(command.heldAt)).toEither match
      case Left(_) =>
        MonadThrow[F].pure(
          Left(AppError.ValidationFailed("heldAt must be ISO8601 instant."))
        )
      case Right(instant) =>
        (for
          id <- EitherT.liftF(nextId)
          event = HeldEvent(id = id, heldAt = instant)
          _ <- EitherT.liftF(events.create(event))
        yield event).value
