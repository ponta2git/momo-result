package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT

import momo.api.domain.HeldEvent
import momo.api.domain.ids.*
import momo.api.errors.AppError
import momo.api.repositories.HeldEventsRepository

final case class CreateHeldEventCommand(heldAt: Instant)

final class CreateHeldEvent[F[_]: MonadThrow](
    events: HeldEventsRepository[F],
    nextId: F[HeldEventId],
):
  def run(command: CreateHeldEventCommand): F[Either[AppError, HeldEvent]] = (for
    id <- EitherT.liftF(nextId)
    event = HeldEvent(id = id, heldAt = command.heldAt)
    _ <- EitherT.liftF(events.create(event))
  yield event).value
