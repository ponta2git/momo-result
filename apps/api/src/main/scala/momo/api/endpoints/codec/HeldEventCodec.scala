package momo.api.endpoints.codec

import momo.api.endpoints.CreateHeldEventRequest
import momo.api.usecases.CreateHeldEventCommand

/** DTO ↔ usecase command conversions for `HeldEventsEndpoints`. */
object HeldEventCodec:
  def toCreateCommand(request: CreateHeldEventRequest): CreateHeldEventCommand =
    CreateHeldEventCommand(request.heldAt)
end HeldEventCodec
