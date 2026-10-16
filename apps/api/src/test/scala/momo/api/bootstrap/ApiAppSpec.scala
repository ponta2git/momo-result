package momo.api.bootstrap

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv}

final class ApiAppSpec extends MomoCatsEffectSuite:
  test("the application cannot silently replace missing persistence with memory"):
    tempDirectory("momo-api-required-database").use { directory =>
      ApiApp.resource[IO](AppConfig(
        appEnv = AppEnv.Test,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = directory,
        devMemberIds = List("member_ponta"),
      )).use(_ => IO.unit).attempt.map { result =>
        result match
          case Left(_: IllegalArgumentException) => ()
          case other => fail(s"expected missing database rejection, got $other")
      }
    }
