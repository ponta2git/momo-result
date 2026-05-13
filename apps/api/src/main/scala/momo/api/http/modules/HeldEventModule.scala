package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.HeldEventId
import momo.api.endpoints.codec.HeldEventCodec
import momo.api.endpoints.{
  CreateHeldEventRequest, DeleteHeldEventResponse, HeldEventListResponse, HeldEventResponse,
  HeldEventsEndpoints,
}
import momo.api.http.{EndpointSecurity, IdempotencyReplay}
import momo.api.repositories.IdempotencyRepository
import momo.api.usecases.{CreateHeldEvent, DeleteHeldEvent, ListHeldEvents}

object HeldEventModule:
  def routes[F[_]: Async](
      listHeldEvents: ListHeldEvents[F],
      createHeldEvent: CreateHeldEvent[F],
      deleteHeldEvent: DeleteHeldEvent[F],
      idempotency: IdempotencyRepository[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    HeldEventsEndpoints.list.serverLogic { case (q, limit, accountHeader) =>
      security.authorizeRead(accountHeader) { _ =>
        listHeldEvents.run(q, limit).map(items =>
          Right(HeldEventListResponse(items.map((e, c) => HeldEventResponse.from(e, c))))
        )
      }
    },
    HeldEventsEndpoints.create.serverLogic { case (accountHeader, csrfToken, idemKey, request) =>
      security.authorizeMutation(accountHeader, csrfToken) { member =>
        IdempotencyReplay.wrap[F, CreateHeldEventRequest, HeldEventResponse](
          idempotency,
          idemKey,
          member,
          "POST /api/held-events",
          request,
          nowF,
          security.respond(
            createHeldEvent.run(HeldEventCodec.toCreateCommand(request))
          )(event => HeldEventResponse.from(event, 0)),
        )
      }
    },
    HeldEventsEndpoints.delete.serverLogic { case (heldEventId, accountHeader, csrfToken) =>
      security.authorizeMutation(accountHeader, csrfToken) { _ =>
        security.respond(deleteHeldEvent.run(HeldEventId.unsafeFromString(heldEventId))) { _ =>
          DeleteHeldEventResponse(heldEventId = heldEventId, deleted = true)
        }
      }
    },
  )
