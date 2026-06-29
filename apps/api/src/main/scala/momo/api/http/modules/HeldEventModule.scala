package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.HeldEventId
import momo.api.endpoints.codec.{BoundaryId, HeldEventCodec}
import momo.api.endpoints.{
  CreateHeldEventRequest,
  DeleteHeldEventResponse,
  HeldEventListResponse,
  HeldEventResponse,
  HeldEventsEndpoints,
  PaginationResponse
}
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.heldevents.{CreateHeldEvent, DeleteHeldEvent, ListHeldEvents}

object HeldEventModule:
  def routes[F[_]: Async](
      listHeldEvents: ListHeldEvents[F],
      createHeldEvent: CreateHeldEvent[F],
      deleteHeldEvent: DeleteHeldEvent[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.readLogic(security, HeldEventsEndpoints.list) { _ =>
      {
        case (q, limit, page, pageSize) =>
          security.respond(listHeldEvents.run(q, limit, page, pageSize))(result =>
            HeldEventListResponse(
              items = result.items.map((e, c) => HeldEventResponse.from(e, c)),
              pagination = PaginationResponse.from(result.pagination),
              totalMatchCount = result.totalMatchCount,
            )
          )
      }
    },
    SecuredEndpoint.mutationLogic(security, HeldEventsEndpoints.create) { member =>
      {
        case (idemKey, request) =>
          IdempotencyReplay.wrap[F, CreateHeldEventRequest, HeldEventResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.CreateHeldEvent,
            request,
            nowF,
            security.decode(HeldEventCodec.toCreateCommand(request))(command =>
              security
                .respond(createHeldEvent.run(command))(event => HeldEventResponse.from(event, 0))
            ),
          )
      }
    },
    SecuredEndpoint.mutationLogic(security, HeldEventsEndpoints.delete) { member =>
      {
        case (heldEventId, idemKey) =>
          IdempotencyReplay.wrap[F, String, DeleteHeldEventResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.DeleteHeldEvent,
            heldEventId,
            nowF,
            security.decode(BoundaryId.required(
              "heldEventId",
              heldEventId
            )(HeldEventId.fromString))(id =>
              security.respond(deleteHeldEvent.run(id)) { _ =>
                DeleteHeldEventResponse(heldEventId = heldEventId, deleted = true)
              }
            ),
          )
      }
    },
  )
