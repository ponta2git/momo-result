package momo.api.repositories

import java.time.Instant

import momo.api.domain.{NotificationSettings, NotificationSettingsUpdate}
import momo.api.errors.AppError

trait NotificationSettingsRepository[F[_]]:
  def get: F[NotificationSettings]

  /**
   * Compare both generations and atomically save changes with the cancellation of unsent
   * notifications. A conflict changes nothing; delivery that already began keeps its evidence.
   */
  def update(
      requested: NotificationSettingsUpdate,
      now: Instant
  ): F[Either[AppError, NotificationSettings]]
