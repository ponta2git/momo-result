package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.{
  NotificationGeneration,
  NotificationSetting,
  NotificationSettings,
  NotificationSettingsUpdate,
  ResultNotificationKind
}
import momo.api.errors.AppError
import momo.api.repositories.NotificationSettingsRepository

object PostgresNotificationSettings:
  def get: ConnectionIO[NotificationSettings] =
    sql"SELECT kind, enabled, generation FROM discord_notification_settings"
      .query[(String, Boolean, Long)].to[List].flatMap { rows =>
        def setting(kind: ResultNotificationKind): Either[String, NotificationSetting] =
          rows.find(_._1 == kind.wire).toRight(s"Missing ${kind.wire} setting").flatMap { row =>
            NotificationGeneration.fromLong(row._3).map(NotificationSetting(row._2, _))
          }
        (
          setting(ResultNotificationKind.OcrCompleted),
          setting(ResultNotificationKind.AnalysisCompleted)
        )
          .mapN(NotificationSettings.apply).leftMap(reason =>
            PostgresDataIntegrityException.inconsistentRow(
              "discord_notification_settings",
              "global",
              reason
            )
          ).liftTo[ConnectionIO]
      }

  def update(
      requested: NotificationSettingsUpdate,
      now: Instant,
  ): ConnectionIO[Either[AppError, NotificationSettings]] =
    for
      _ <- sql"SET TRANSACTION ISOLATION LEVEL READ COMMITTED".update.run
      _ <-
        sql"SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '10s', true)"
          .query[(String, String)].unique
      _ <- PostgresResultNotificationCancellation.acquireGate
      current <- get
      result <- NotificationSettings.change(current, requested) match
        case Left(error) => error.asLeft[NotificationSettings].pure[ConnectionIO]
        case Right(change) =>
          for
            _ <- change.changedKinds.traverse_ { kind =>
              val setting = change.settings(kind)
              sql"""
                UPDATE discord_notification_settings
                SET enabled = ${setting.enabled}, generation = ${setting.generation.value}, updated_at = $now
                WHERE kind = ${kind.wire}
              """.update.run
            }
            _ <- PostgresResultNotificationCancellation.settingsDisabled(change.disabledKinds, now)
          yield Right(change.settings)
    yield result

final class PostgresNotificationSettingsRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F]
) extends NotificationSettingsRepository[F]:
  def get: F[NotificationSettings] = PostgresNotificationSettings.get.transact(transactor)

  def update(
      requested: NotificationSettingsUpdate,
      now: Instant
  ): F[Either[AppError, NotificationSettings]] =
    PostgresNotificationSettings.update(requested, now).transact(transactor)
