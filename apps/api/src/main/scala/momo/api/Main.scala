package momo.api

import cats.effect.{ExitCode, IO, IOApp}
import com.comcast.ip4s.*
import org.http4s.ember.server.EmberServerBuilder
import org.slf4j.LoggerFactory

import momo.api.config.AppConfig
import momo.api.http.HttpApp

object Main extends IOApp:
  private val logger = LoggerFactory.getLogger(getClass)

  override def run(_args: List[String]): IO[ExitCode] = AppConfig.load[IO].flatMap { config =>
    val host = Host.fromString(config.httpHost).getOrElse(host"0.0.0.0")
    val port = Port.fromInt(config.httpPort).getOrElse(port"8080")

    HttpApp.resource[IO](config).flatMap(app =>
      EmberServerBuilder.default[IO].withHost(host).withPort(port).withHttpApp(app).build
    ).use { _ =>
      val startedMessage = "momo_result_api_started " + s"host=${config.httpHost} " +
        s"port=${config.httpPort} " + s"env=${config.appEnv}"
      IO.delay(logger.info(startedMessage)) *>
        IO.never.guarantee(IO.delay(logger.info("momo_result_api_stopping")))
    }
  }.as(ExitCode.Success).handleErrorWith { error =>
    IO.delay(logger.error("momo_result_api_fatal", error)).as(ExitCode.Error)
  }
