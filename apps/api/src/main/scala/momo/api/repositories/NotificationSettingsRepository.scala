package momo.api.repositories

import java.time.Instant

import momo.api.domain.{NotificationSettings, NotificationSettingsUpdate}
import momo.api.errors.AppError

trait NotificationSettingsRepository[F[_]]:
  def get: F[NotificationSettings]

  /** Read, evaluate NotificationSettings.change, save and cancel in one atomic command. */
  def update(requested: NotificationSettingsUpdate, now: Instant): F[Either[AppError, NotificationSettings]]
