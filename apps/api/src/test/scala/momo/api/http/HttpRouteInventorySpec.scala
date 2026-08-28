package momo.api.http

import cats.effect.IO
import sttp.tapir.AnyEndpoint

import momo.api.MomoCatsEffectSuite
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv}
import momo.api.endpoints.ApiEndpoints

final class HttpRouteInventorySpec extends MomoCatsEffectSuite:
  test("each runtime environment registers every documented method and path exactly once"):
    for
      _ <- assertRuntimeInventory(AppEnv.Test, "http-route-inventory-test")
      _ <- assertRuntimeInventory(AppEnv.Prod, "http-route-inventory-prod")
    yield ()

  private def assertRuntimeInventory(appEnv: AppEnv, prefix: String): IO[Unit] =
    tempDirectory(prefix).flatMap { imageDirectory =>
      ApiApp.wired[IO](AppConfig(
        appEnv = appEnv,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = imageDirectory,
        devMemberIds = List("member_ponta"),
      ))
    }.use { runtime =>
      IO {
        val registered = inventory(runtime.registeredEndpoints)
        assertEquals(registered, registered.distinct)
        assertEquals(registered, inventory(ApiEndpoints.all))
      }
    }

  private def inventory(endpoints: List[AnyEndpoint]): List[String] = endpoints
    .map(endpoint =>
      val method = endpoint.method.fold("*")(_.method)
      val path = endpoint.showPathTemplate(showQueryParam = None, includeAuth = false)
      s"$method $path"
    )
    .sorted
