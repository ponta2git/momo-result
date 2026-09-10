package momo.api.adapters.inmemory

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.domain.{NotificationSettings, NotificationSettingsUpdate}
import momo.api.errors.AppError
import momo.api.repositories.NotificationSettingsRepository

/** The development runtime has no notification consumer; it uses the same setting policy. */
final class InMemoryNotificationSettingsRepository[F[_]] private (
    state: Ref[F, NotificationSettings]
) extends NotificationSettingsRepository[F]:
  def get: F[NotificationSettings] = state.get

  def update(
      requested: NotificationSettingsUpdate,
      now: Instant
  ): F[Either[AppError, NotificationSettings]] =
    state.modify { current =>
      NotificationSettings.change(current, requested) match
        case Left(error) => (current, Left(error))
        case Right(change) => (change.settings, Right(change.settings))
    }

object InMemoryNotificationSettingsRepository:
  def create[F[_]: Sync]: F[InMemoryNotificationSettingsRepository[F]] =
    Ref.of[F, NotificationSettings](NotificationSettings.initial)
      .map(new InMemoryNotificationSettingsRepository(_))
