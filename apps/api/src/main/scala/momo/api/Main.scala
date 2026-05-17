package momo.api

import cats.effect.{ExitCode, IO, IOApp}
import cats.syntax.all.*
import com.comcast.ip4s.*
import org.http4s.ember.server.EmberServerBuilder
import org.slf4j.LoggerFactory

import momo.api.bootstrap.ApiApp
import momo.api.config.AppConfig
import momo.api.logging.SafeLog

object Main extends IOApp:
  private val logger = LoggerFactory.getLogger(getClass)

  override def run(_args: List[String]): IO[ExitCode] = AppConfig.load[IO].flatMap { config =>
    bindAddress(config).flatMap { case (host, port) =>
      ApiApp.resource[IO](config).flatMap(app =>
        EmberServerBuilder.default[IO].withHost(host).withPort(port).withHttpApp(app).build
      ).use { _ =>
        val startedMessage = "momo_result_api_started " + s"host=${config.httpHost} " +
          s"port=${config.httpPort} " + s"env=${config.appEnv}"
        IO.delay(logger.info(startedMessage)) *>
          IO.never.guarantee(IO.delay(logger.info("momo_result_api_stopping")))
      }
    }
  }.as(ExitCode.Success).handleErrorWith { error =>
    val classes = SafeLog.throwableClasses(error)
    IO.delay(logger.error(s"momo_result_api_fatal errorClasses=$classes")).as(ExitCode.Error)
  }

  private[api] def bindAddress(config: AppConfig): IO[(Host, Port)] = (
    Host.fromString(config.httpHost)
      .toRight(new IllegalArgumentException(s"HTTP_HOST is not a valid bind host: ${config
          .httpHost}")),
    Port.fromInt(config.httpPort)
      .toRight(new IllegalArgumentException(s"HTTP_PORT is not a valid bind port: ${config.httpPort
          .toString}")),
  ).mapN((_, _)).liftTo[IO]
