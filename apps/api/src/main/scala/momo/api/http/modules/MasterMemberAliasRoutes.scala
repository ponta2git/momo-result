package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{MemberAliasId, MemberId}
import momo.api.endpoints.codec.{BoundaryId, MasterCodec}
import momo.api.endpoints.{
  CreateMemberAliasRequest,
  DeleteMasterResponse,
  MemberAliasListResponse,
  MemberAliasResponse,
  MemberAliasesEndpoints,
  UpdateMemberAliasRequest
}
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.masters.{
  CreateMemberAlias,
  DeleteMemberAlias,
  ListMemberAliases,
  UpdateMemberAlias
}

private[modules] object MasterMemberAliasRoutes:
  def routes[F[_]: Async](
      listMemberAliases: ListMemberAliases[F],
      createMemberAlias: CreateMemberAlias[F],
      updateMemberAlias: UpdateMemberAlias[F],
      deleteMemberAlias: DeleteMemberAlias[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.readLogic(security, MemberAliasesEndpoints.list) { _ => memberId =>
      security
        .decode(BoundaryId.optional("memberId", memberId)(MemberId.fromString)) { parsedMemberId =>
          security.respond(
            listMemberAliases.run(parsedMemberId)
          )(items => MemberAliasListResponse(items.map(MemberAliasResponse.from)))
        }
    },
    SecuredEndpoint.masterMutationLogic(security, MemberAliasesEndpoints.create) { member =>
      {
        case (idemKey, request) =>
          IdempotencyReplay.wrap[F, CreateMemberAliasRequest, MemberAliasResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.CreateMemberAlias,
            request,
            nowF,
            security.decode(
              MasterCodec.toCreateMemberAliasCommand(request)
            )(command =>
              security.respond(createMemberAlias.run(command))(MemberAliasResponse.from)
            ),
          )
      }
    },
    SecuredEndpoint.masterMutationLogic(security, MemberAliasesEndpoints.update) { member =>
      {
        case (id, idemKey, request) =>
          IdempotencyReplay.wrap[F, (String, UpdateMemberAliasRequest), MemberAliasResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.UpdateMemberAlias,
            (id, request),
            nowF,
            security.decode(MasterCodec.toUpdateMemberAliasCommand(id, request))(command =>
              security.respond(updateMemberAlias.run(command))(MemberAliasResponse.from)
            ),
          )
      }
    },
    SecuredEndpoint.masterMutationLogic(security, MemberAliasesEndpoints.delete) { member =>
      {
        case (id, idemKey) =>
          IdempotencyReplay.wrap[F, String, DeleteMasterResponse](
            idempotency,
            idemKey,
            member,
            HttpOperation.DeleteMemberAlias,
            id,
            nowF,
            security.decode(BoundaryId.required("id", id)(MemberAliasId.fromString))(parsedId =>
              security.respond(
                deleteMemberAlias.run(parsedId)
              )(_ => DeleteMasterResponse(id, deleted = true))
            ),
          )
      }
    },
  )
