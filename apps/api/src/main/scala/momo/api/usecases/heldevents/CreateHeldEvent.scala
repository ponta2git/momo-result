package momo.api.usecases.heldevents

import java.time.Instant

import cats.Monad
import cats.data.EitherT

import momo.api.domain.HeldEvent
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.HeldEventsRepository

final case class CreateHeldEventCommand(heldAt: Instant)

final class CreateHeldEvent[F[_]: Monad](
    events: HeldEventsRepository[F],
    nextId: F[HeldEventId],
):
  def run(command: CreateHeldEventCommand): F[Either[AppError, HeldEvent]] = (for
    id <- EitherT.liftF(nextId)
    event = HeldEvent(id = id, heldAt = command.heldAt)
    _ <- EitherT(events.create(event))
  yield event).value
