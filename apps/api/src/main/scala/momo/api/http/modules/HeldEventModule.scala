package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.endpoints.codec.HeldEventCodec
import momo.api.endpoints.{
  CreateHeldEventRequest, HeldEventListResponse, HeldEventResponse, HeldEventsEndpoints,
}
import momo.api.http.{EndpointSecurity, IdempotencyHandler}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{CreateHeldEvent, ListHeldEvents}

object HeldEventModule:
  def routes[F[_]: Async](
      listHeldEvents: ListHeldEvents[F],
      createHeldEvent: CreateHeldEvent[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    HeldEventsEndpoints.list.serverLogic { case (q, limit, devUser) =>
      security.authorizeRead(devUser) { _ =>
        listHeldEvents.run(q, limit).map(items =>
          Right(HeldEventListResponse(items.map((e, c) => HeldEventResponse.from(e, c))))
        )
      }
    },
    HeldEventsEndpoints.create.serverLogic { case (devUser, csrfToken, idemKey, request) =>
      security.authorizeMutation(devUser, csrfToken) { member =>
        IdempotencyHandler.wrap[F, CreateHeldEventRequest, HeldEventResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/held-events",
          request,
          nowF,
          security.respond(createHeldEvent.run(HeldEventCodec.toCreateCommand(request)))(event =>
            HeldEventResponse.from(event, 0)
          ),
        )
      }
    },
  )
