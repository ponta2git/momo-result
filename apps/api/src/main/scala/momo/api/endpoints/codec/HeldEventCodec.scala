package momo.api.endpoints.codec

import java.time.Instant
import java.time.format.DateTimeParseException

import cats.syntax.all.*

import momo.api.endpoints.CreateHeldEventRequest
import momo.api.errors.AppError
import momo.api.usecases.CreateHeldEventCommand

/** DTO ↔ usecase command conversions for `HeldEventsEndpoints`. */
object HeldEventCodec:
  def toCreateCommand(request: CreateHeldEventRequest): Either[AppError, CreateHeldEventCommand] =
    parseHeldAt(request.heldAt).map(CreateHeldEventCommand(_))

  private def parseHeldAt(value: String): Either[AppError, Instant] = Either
    .catchOnly[DateTimeParseException](Instant.parse(value))
    .leftMap(_ => AppError.ValidationFailed("heldAt must be ISO8601 instant."))
end HeldEventCodec
