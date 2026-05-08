package momo.api.http

import java.nio.file.Path

import cats.effect.{IO, Resource}
import org.http4s.{Header, HttpApp as Http4sApp}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv}

trait HttpAppTestFixtures:
  this: MomoCatsEffectSuite =>

  protected type TestHttpApp = Http4sApp[IO]

  protected def httpAppResource(prefix: String): Resource[IO, TestHttpApp] =
    httpAppResourceWith(prefix, AppEnv.Test, identity)

  protected def prodHttpAppResource(prefix: String): Resource[IO, TestHttpApp] =
    httpAppResourceWith(prefix, AppEnv.Prod, identity)

  protected def configuredHttpAppResource(
      prefix: String,
      configure: AppConfig => AppConfig,
  ): Resource[IO, TestHttpApp] = httpAppResourceWith(prefix, AppEnv.Test, configure)

  protected def wiredHttpAppResource(prefix: String): Resource[IO, TestHttpApp] =
    wiredHttpAppResourceWith(prefix, identity, _ => IO.unit)

  protected def seededWiredHttpAppResource(
      prefix: String,
      seed: HttpApp.Wired[IO] => IO[Unit],
  ): Resource[IO, TestHttpApp] = wiredHttpAppResourceWith(prefix, identity, seed)

  protected def devReadHeader(): Header.Raw = devReadHeader("ponta")

  protected def devReadHeader(memberId: String): Header.Raw = Header
    .Raw(CIString("X-Dev-User"), memberId)

  protected def devWriteHeaders(): List[Header.ToRaw] = devWriteHeaders("ponta", None)

  protected def devWriteHeadersWithIdempotency(idempotencyKey: Option[String]): List[Header.ToRaw] =
    devWriteHeaders("ponta", idempotencyKey)

  private def httpAppResourceWith(
      prefix: String,
      appEnv: AppEnv,
      configure: AppConfig => AppConfig,
  ): Resource[IO, TestHttpApp] = tempDirectory(prefix)
    .flatMap(dir => HttpApp.resource[IO](configure(defaultConfig(dir, appEnv))))

  private def wiredHttpAppResourceWith(
      prefix: String,
      configure: AppConfig => AppConfig,
      seed: HttpApp.Wired[IO] => IO[Unit],
  ): Resource[IO, TestHttpApp] = tempDirectory(prefix).flatMap { dir =>
    HttpApp.wired[IO](configure(defaultConfig(dir, AppEnv.Test))).evalTap(seed).map(_.app)
  }

  private def devWriteHeaders(
      memberId: String,
      idempotencyKey: Option[String],
  ): List[Header.ToRaw] =
    val base =
      List[Header.ToRaw](devReadHeader(memberId), Header.Raw(CIString("X-CSRF-Token"), "dev"))
    idempotencyKey
      .fold(base)(key => base :+ (Header.Raw(CIString("Idempotency-Key"), key): Header.ToRaw))

  private def defaultConfig(dir: Path, appEnv: AppEnv): AppConfig = AppConfig(
    appEnv = appEnv,
    httpHost = "127.0.0.1",
    httpPort = 0,
    imageTmpDir = dir,
    devMemberIds = List("ponta", "akane-mami", "otaka", "eu"),
  )
