package momo.api.http.modules

import sttp.tapir.server.ServerEndpoint

import momo.api.domain.PublicId
import momo.api.domain.ids.HeldEventId
import momo.api.endpoints.codec.{BoundaryId, HeldEventCodec, HeldEventListCodec}
import momo.api.endpoints.{
  DeleteHeldEventResponse,
  HeldEventDetailResponse,
  HeldEventListItemResponse,
  HeldEventListResponse,
  HeldEventResponse,
  HeldEventSummaryResponse,
  HeldEventsEndpoints,
  PaginationResponse
}
import momo.api.errors.AppError
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.heldevents.{
  CreateHeldEvent,
  DeleteHeldEvent,
  GetHeldEventDetail,
  ListHeldEvents
}

object HeldEventModule:
  final case class UseCases[F[_]](
      listHeldEvents: ListHeldEvents[F],
      getHeldEventDetail: GetHeldEventDetail[F],
      createHeldEvent: CreateHeldEvent[F],
      deleteHeldEvent: DeleteHeldEvent[F],
  )

  def routes[F[_]](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.readLogic(security, HeldEventsEndpoints.list) { _ => input =>
        execution.execute(HeldEventListCodec.toListCommand(
          limit = input.limit,
          page = input.page,
          pageSize = input.pageSize,
          sort = input.sort,
          search = HeldEventListCodec.SearchParams(
            gameTitleId = input.gameTitleId,
            seasonMasterId = input.seasonMasterId,
            mapMasterId = input.mapMasterId,
            from = input.from,
            to = input.to,
            minMatchCount = input.minMatchCount,
            q = input.q,
            memberId = input.memberId,
            metric = input.metric,
            metricValue = input.metricValue,
            metricRange = input.metricRange,
          ),
        ))(listHeldEvents.run)(result =>
          HeldEventListResponse(
            items = result.page.items.map(HeldEventListItemResponse.from),
            pagination = PaginationResponse.from(result.page),
            totalMatchCount = result.totalMatchCount,
            latestHeldEventId = result.latestHeldEventId.map(_.value),
          )
        )
      },
      SecuredEndpoint.readLogic(security, HeldEventsEndpoints.get) { _ => heldEventId =>
        execution.execute(
          BoundaryId.required(
            "heldEventId",
            heldEventId,
          )(HeldEventId.fromString)
        )(id => getHeldEventDetail.run(id))(
          HeldEventDetailResponse.from
        )
      },
      SecuredEndpoint.readLogic(security, HeldEventsEndpoints.summary) { _ => heldEventId =>
        execution.execute(
          BoundaryId.required("heldEventId", heldEventId)(HeldEventId.fromString)
        )(id => getHeldEventDetail.summary(id))(
          HeldEventSummaryResponse.from
        )
      },
      SecuredEndpoint.readLogic(security, HeldEventsEndpoints.getByPublicId) { _ => publicId =>
        execution.execute(
          PublicId.fromString(publicId).left.map(_ =>
            AppError.ValidationFailed("publicId is invalid.")
          )
        )(getHeldEventDetail.byPublicId)(HeldEventDetailResponse.from)
      },
      SecuredEndpoint.mutationLogic(security, HeldEventsEndpoints.create) { member =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.CreateHeldEvent,
              idemKey,
              member,
              request,
            )(
              HeldEventCodec.toCreateCommand(request)
            )(command =>
              createHeldEvent.run(command)
            )(event =>
              HeldEventResponse.from(
                event,
                matchCount = 0,
                draftCount = 0,
                nextMatchNo = 1,
                scopes = Nil
              )
            )
        }
      },
      SecuredEndpoint.mutationLogic(security, HeldEventsEndpoints.delete) { member =>
        {
          case (heldEventId, idemKey) =>
            execution.mutation(
              HttpOperation.DeleteHeldEvent,
              idemKey,
              member,
              heldEventId,
            )(
              BoundaryId.required(
                "heldEventId",
                heldEventId
              )(HeldEventId.fromString)
            )(id =>
              deleteHeldEvent.run(id)
            )(_ =>
              DeleteHeldEventResponse(heldEventId = heldEventId, deleted = true)
            )
        }
      },
    )
