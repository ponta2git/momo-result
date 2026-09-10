package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

import momo.api.domain.{NotificationSetting, NotificationSettings}

final case class NotificationSettingResponse(enabled: Boolean, generation: String) derives Codec.AsObject

object NotificationSettingResponse:
  def from(setting: NotificationSetting): NotificationSettingResponse =
    NotificationSettingResponse(setting.enabled, setting.generation.value.toString)

final case class NotificationSettingsResponse(
    ocrCompleted: NotificationSettingResponse,
    analysisCompleted: NotificationSettingResponse,
) derives Codec.AsObject

object NotificationSettingsResponse:
  def from(settings: NotificationSettings): NotificationSettingsResponse = NotificationSettingsResponse(
    NotificationSettingResponse.from(settings.ocrCompleted),
    NotificationSettingResponse.from(settings.analysisCompleted),
  )

final case class NotificationSettingUpdateRequest(enabled: Boolean, expectedGeneration: String) derives Codec.AsObject

final case class NotificationSettingsUpdateRequest(
    ocrCompleted: NotificationSettingUpdateRequest,
    analysisCompleted: NotificationSettingUpdateRequest,
) derives Codec.AsObject

object NotificationSettingsEndpoints:
  val get: CommonEndpoint.SecuredRead[Unit, NotificationSettingsResponse] = endpoint
    .get
    .in("api" / "admin" / "notification-settings")
    .securityIn(CommonEndpoint.accountHeader)
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[NotificationSettingsResponse])
    .tag("admin")

  val update: CommonEndpoint.SecuredMutation[
    (Option[String], NotificationSettingsUpdateRequest),
    NotificationSettingsResponse,
  ] = endpoint
    .put
    .in("api" / "admin" / "notification-settings")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[NotificationSettingsUpdateRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[NotificationSettingsResponse])
    .tag("admin")
