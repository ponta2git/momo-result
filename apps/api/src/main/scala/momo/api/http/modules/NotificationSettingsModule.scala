package momo.api.http.modules

import java.time.Instant

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.{
  NotificationGeneration,
  NotificationSettingUpdate,
  NotificationSettingsUpdate
}
import momo.api.endpoints.{
  NotificationSettingUpdateRequest,
  NotificationSettingsEndpoints,
  NotificationSettingsResponse,
  NotificationSettingsUpdateRequest
}
import momo.api.errors.AppError
import momo.api.http.{EndpointSecurity, HttpOperation, IdempotencyReplay, SecuredEndpoint}
import momo.api.usecases.admin.{GetNotificationSettings, UpdateNotificationSettings}

object NotificationSettingsModule:
  def routes[F[_]: Async](
      getSettings: GetNotificationSettings[F],
      updateSettings: UpdateNotificationSettings[F],
      idempotency: IdempotencyReplay.Guard[F],
      nowF: F[Instant],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    SecuredEndpoint.adminReadLogic(security, NotificationSettingsEndpoints.get) { _ => _ =>
      getSettings.run.map(settings => Right(NotificationSettingsResponse.from(settings)))
    },
    SecuredEndpoint.adminMutationLogic(security, NotificationSettingsEndpoints.update) { account =>
      { case (key, request) =>
        IdempotencyReplay.wrap[F, NotificationSettingsUpdateRequest, NotificationSettingsResponse](
          idempotency,
          key,
          account,
          HttpOperation.UpdateNotificationSettings,
          request,
          nowF,
          security.decode(toCommand(request))(command =>
            security.respond(updateSettings.run(command))(NotificationSettingsResponse.from)
          ),
        )
      }
    },
  )

  private def toCommand(request: NotificationSettingsUpdateRequest)
      : Either[AppError, NotificationSettingsUpdate] =
    def setting(value: NotificationSettingUpdateRequest)
        : Either[AppError, NotificationSettingUpdate] =
      NotificationGeneration.fromString(value.expectedGeneration)
        .leftMap(AppError.ValidationFailed.apply).map(NotificationSettingUpdate(value.enabled, _))
    (
      setting(request.ocrCompleted),
      setting(request.analysisCompleted)
    ).mapN(NotificationSettingsUpdate.apply)
