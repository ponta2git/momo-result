package momo.api.http

import java.nio.file.Path

import cats.effect.{IO, Resource}
import fs2.Stream
import io.circe.Json
import org.http4s.circe.*
import org.http4s.headers.`Content-Type`
import org.http4s.multipart.{Multiparts, Part}
import org.http4s.{Header, HttpApp as Http4sApp, MediaType, Method, Request, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.auth.AuthHeaderNames
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv}
import momo.api.testing.TestImages

trait HttpAppTestFixtures:
  this: MomoCatsEffectSuite =>

  protected type TestHttpApp = Http4sApp[IO]

  protected val DefaultAccountId = "account_ponta"

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
      seed: ApiApp.Runtime[IO] => IO[Unit],
  ): Resource[IO, TestHttpApp] = wiredHttpAppResourceWith(prefix, identity, seed)

  protected def devReadHeader(): Header.Raw = devReadHeader(DefaultAccountId)

  protected def devReadHeader(accountId: String): Header.Raw = Header
    .Raw(CIString(AuthHeaderNames.AccountId), accountId)

  protected def devWriteHeaders(): List[Header.ToRaw] = devWriteHeaders(DefaultAccountId, None)

  protected def devWriteHeadersWithIdempotency(idempotencyKey: Option[String]): List[Header.ToRaw] =
    devWriteHeaders(DefaultAccountId, idempotencyKey)

  protected def readRequest(method: Method, uri: Uri): Request[IO] =
    readRequest(method, uri, DefaultAccountId)

  protected def readRequest(method: Method, uri: Uri, accountId: String): Request[IO] =
    Request[IO](method, uri).putHeaders(devReadHeader(accountId))

  protected def writeRequest(method: Method, uri: Uri): Request[IO] =
    writeRequest(method, uri, DefaultAccountId, None)

  protected def writeRequest(
      method: Method,
      uri: Uri,
      idempotencyKey: Option[String],
  ): Request[IO] = writeRequest(method, uri, DefaultAccountId, idempotencyKey)

  protected def writeRequest(method: Method, uri: Uri, accountId: String): Request[IO] =
    writeRequest(method, uri, accountId, None)

  protected def writeRequest(
      method: Method,
      uri: Uri,
      accountId: String,
      idempotencyKey: Option[String],
  ): Request[IO] = Request[IO](method, uri).putHeaders(devWriteHeaders(accountId, idempotencyKey)*)

  protected def readGet(uri: Uri): Request[IO] = readGet(uri, DefaultAccountId)

  protected def readGet(uri: Uri, accountId: String): Request[IO] =
    readRequest(Method.GET, uri, accountId)

  protected def writePost(uri: Uri, body: Json): Request[IO] =
    writePost(uri, body, DefaultAccountId, None)

  protected def writePost(uri: Uri, body: Json, accountId: String): Request[IO] =
    writePost(uri, body, accountId, None)

  protected def writePost(uri: Uri, body: Json, idempotencyKey: Option[String]): Request[IO] =
    writePost(uri, body, DefaultAccountId, idempotencyKey)

  protected def writePost(
      uri: Uri,
      body: Json,
      accountId: String,
      idempotencyKey: Option[String],
  ): Request[IO] = writeRequest(Method.POST, uri, accountId, idempotencyKey).withEntity(body)

  protected def writePatch(uri: Uri, body: Json): Request[IO] =
    writePatch(uri, body, DefaultAccountId)

  protected def writePatch(uri: Uri, body: Json, accountId: String): Request[IO] =
    writeRequest(Method.PATCH, uri, accountId).withEntity(body)

  protected def writeDelete(uri: Uri): Request[IO] = writeDelete(uri, DefaultAccountId)

  protected def writeDelete(uri: Uri, accountId: String): Request[IO] =
    writeRequest(Method.DELETE, uri, accountId)

  protected def sessionCookieHeader(value: String): Header.Raw = Header
    .Raw(CIString("Cookie"), s"momo_result_session=$value")

  protected def uploadPngRequest(): IO[Request[IO]] = uploadPngRequest(1)

  protected def uploadPngRequest(filePartCount: Int): IO[Request[IO]] =
    val parts = Vector.tabulate(filePartCount) { index =>
      Part.fileData[IO](
        "file",
        s"source-${index + 1}.png",
        Stream.emits(TestImages.png1x1).covary[IO],
        `Content-Type`(MediaType.image.png),
      )
    }
    for
      multiparts <- Multiparts.forSync[IO]
      multipart <- multiparts.multipart(parts)
    yield writeRequest(Method.POST, uri = Uri.unsafeFromString("/api/uploads/images"))
      .putHeaders(multipart.headers).withEntity(multipart)

  private def httpAppResourceWith(
      prefix: String,
      appEnv: AppEnv,
      configure: AppConfig => AppConfig,
  ): Resource[IO, TestHttpApp] = tempDirectory(prefix)
    .flatMap(dir => ApiApp.resource[IO](configure(defaultConfig(dir, appEnv))))

  private def wiredHttpAppResourceWith(
      prefix: String,
      configure: AppConfig => AppConfig,
      seed: ApiApp.Runtime[IO] => IO[Unit],
  ): Resource[IO, TestHttpApp] = tempDirectory(prefix).flatMap { dir =>
    ApiApp.wired[IO](configure(defaultConfig(dir, AppEnv.Test))).evalTap(seed).map(_.app)
  }

  private def devWriteHeaders(
      accountId: String,
      idempotencyKey: Option[String],
  ): List[Header.ToRaw] =
    val base = List[Header.ToRaw](
      devReadHeader(accountId),
      Header.Raw(CIString(AuthHeaderNames.CsrfToken), "dev"),
    )
    idempotencyKey.fold(base)(key =>
      base :+ (Header.Raw(CIString(AuthHeaderNames.IdempotencyKey), key): Header.ToRaw)
    )

  private def defaultConfig(dir: Path, appEnv: AppEnv): AppConfig = AppConfig(
    appEnv = appEnv,
    httpHost = "127.0.0.1",
    httpPort = 0,
    imageTmpDir = dir,
    devMemberIds = List("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
  )
