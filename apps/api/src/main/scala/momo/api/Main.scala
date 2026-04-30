package momo.api

import cats.effect.{IO, IOApp}
import com.comcast.ip4s.*
import momo.api.config.AppConfig
import momo.api.http.HttpApp
import org.http4s.ember.server.EmberServerBuilder

object Main extends IOApp.Simple:
  override def run: IO[Unit] = AppConfig.load[IO].flatMap { config =>
    val host = Host.fromString(config.httpHost).getOrElse(host"0.0.0.0")
    val port = Port.fromInt(config.httpPort).getOrElse(port"8080")

    HttpApp.resource[IO](config).flatMap(app =>
      EmberServerBuilder.default[IO].withHost(host).withPort(port).withHttpApp(app).build
    ).use(_ => IO.never)
  }
