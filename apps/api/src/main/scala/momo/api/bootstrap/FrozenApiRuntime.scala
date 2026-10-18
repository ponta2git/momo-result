package momo.api.bootstrap

import cats.effect.{Async, Resource}

import momo.api.adapters.postgres.MaintenanceReadiness
import momo.api.config.AppConfig
import momo.api.db.Database
import momo.api.http.FrozenHttpApp

/** Construct only read-only readiness. Normal wiring starts writers during resource acquisition. */
private[bootstrap] object FrozenApiRuntime:
  def resource[F[_]: Async](config: AppConfig): Resource[F, ApiApp.Runtime[F]] =
    config.database match
      case Some(database) => Database.transactor[F](database).map { transactor =>
          ApiApp.Runtime(
            FrozenHttpApp(MaintenanceReadiness.check(transactor, database.jdbcUrl)),
            Async[F].never[Nothing],
          )
        }
      case None => Resource.eval(Async[F].raiseError(new IllegalArgumentException(
          "API runtime requires a database configuration."
        )))
