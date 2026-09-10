package momo.api.usecases.admin

import java.time.Instant

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.{NotificationSettings, NotificationSettingsUpdate}
import momo.api.errors.AppError
import momo.api.repositories.NotificationSettingsRepository

final class GetNotificationSettings[F[_]](settings: NotificationSettingsRepository[F]):
  def run: F[NotificationSettings] = settings.get

final class UpdateNotificationSettings[F[_]: Monad](
    settings: NotificationSettingsRepository[F],
    now: F[Instant],
):
  def run(requested: NotificationSettingsUpdate): F[Either[AppError, NotificationSettings]] =
    now.flatMap(settings.update(requested, _))
