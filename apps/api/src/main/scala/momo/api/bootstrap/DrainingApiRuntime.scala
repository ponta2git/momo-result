package momo.api.bootstrap

import cats.effect.{Async, Resource}
import cats.syntax.all.*

import momo.api.config.AppConfig
import momo.api.http.MaintenanceHttpApp
import momo.api.maintenance.MaintenanceDrain

private[bootstrap] object DrainingApiRuntime:
  def resource[F[_]: Async](
      config: AppConfig,
      build: MaintenanceDrain[F] => Resource[F, ApiApp.WiredRuntime[F]],
  ): Resource[F, ApiApp.WiredRuntime[F]] =
    for
      maintenance <- MaintenanceDrain.resource[F]()
      allocated <- Resource.make(build(maintenance).allocated) { (_, release) =>
        maintenance.setRelease(release) >> maintenance.release
      }
      (wired, release) = allocated
      _ <- Resource.eval(maintenance.setRelease(release))
    yield wired.copy(runtime =
      wired.runtime.copy(app =
        MaintenanceHttpApp(wired.runtime.app, maintenance, config.maintenanceOperationsToken)
      )
    )
