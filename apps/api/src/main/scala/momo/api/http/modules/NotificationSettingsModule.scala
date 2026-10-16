package momo.api.http.modules

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
import momo.api.http.{HttpOperation, HttpRouteContext, SecuredEndpoint}
import momo.api.usecases.admin.{GetNotificationSettings, UpdateNotificationSettings}

object NotificationSettingsModule:
  final case class UseCases[F[_]](
      getSettings: GetNotificationSettings[F],
      updateSettings: UpdateNotificationSettings[F],
  )

  def routes[F[_]: Async](
      useCases: UseCases[F],
      context: HttpRouteContext[F],
  ): List[ServerEndpoint[Any, F]] =
    import useCases.*
    val security = context.security
    val execution = context.execution
    List(
      SecuredEndpoint.adminReadLogic(security, NotificationSettingsEndpoints.get) { _ => _ =>
        getSettings.run.map(settings => Right(NotificationSettingsResponse.from(settings)))
      },
      SecuredEndpoint.adminMutationLogic(security, NotificationSettingsEndpoints.update) {
        account =>
          { case (key, request) =>
            execution.mutation(
              HttpOperation.UpdateNotificationSettings,
              key,
              account,
              request,
            )(
              toCommand(request)
            )(command =>
              updateSettings.run(command)
            )(
              NotificationSettingsResponse.from
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
