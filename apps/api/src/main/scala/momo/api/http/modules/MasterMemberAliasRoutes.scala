package momo.api.http.modules

import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{MemberAliasId, MemberId}
import momo.api.endpoints.codec.{BoundaryId, MasterCodec}
import momo.api.endpoints.{
  DeleteMasterResponse,
  MemberAliasListResponse,
  MemberAliasResponse,
  MemberAliasesEndpoints
}
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.masters.{
  CreateMemberAlias,
  DeleteMemberAlias,
  ListMemberAliases,
  UpdateMemberAlias
}

private[api] object MasterMemberAliasRoutes:
  final case class UseCases[F[_]](
      listMemberAliases: ListMemberAliases[F],
      createMemberAlias: CreateMemberAlias[F],
      updateMemberAlias: UpdateMemberAlias[F],
      deleteMemberAlias: DeleteMemberAlias[F],
  )

  def routes[F[_]](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.readLogic(security, MemberAliasesEndpoints.list) { _ => memberId =>
        execution.execute(
          BoundaryId.optional("memberId", memberId)(MemberId.fromString)
        )(parsedMemberId => listMemberAliases.run(parsedMemberId))(items =>
          MemberAliasListResponse(items.map(MemberAliasResponse.from))
        )
      },
      SecuredEndpoint.adminMutationLogic(security, MemberAliasesEndpoints.create) { member =>
        {
          case (idemKey, request) =>
            execution.mutation(
              HttpOperation.CreateMemberAlias,
              idemKey,
              member,
              request,
            )(
              MasterCodec.toCreateMemberAliasCommand(request)
            )(command =>
              createMemberAlias.run(command)
            )(
              MemberAliasResponse.from
            )
        }
      },
      SecuredEndpoint.adminMutationLogic(security, MemberAliasesEndpoints.update) { member =>
        {
          case (id, idemKey, request) =>
            execution.mutation(
              HttpOperation.UpdateMemberAlias,
              idemKey,
              member,
              (id, request),
            )(
              MasterCodec.toUpdateMemberAliasCommand(id, request)
            )(command =>
              updateMemberAlias.run(command)
            )(
              MemberAliasResponse.from
            )
        }
      },
      SecuredEndpoint.adminMutationLogic(security, MemberAliasesEndpoints.delete) { member =>
        {
          case (id, idemKey) =>
            execution.mutation(
              HttpOperation.DeleteMemberAlias,
              idemKey,
              member,
              id,
            )(
              BoundaryId.required("id", id)(MemberAliasId.fromString)
            )(parsedId =>
              deleteMemberAlias.run(parsedId)
            )(_ => DeleteMasterResponse(id, deleted = true))
        }
      },
    )
