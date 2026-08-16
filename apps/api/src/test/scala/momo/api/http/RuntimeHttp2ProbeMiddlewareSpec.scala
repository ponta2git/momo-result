package momo.api.http

import cats.data.Kleisli
import cats.effect.IO
import io.circe.parser.parse
import org.http4s.{Header, HttpApp, HttpVersion, Request, Response, Status, Uri}

import momo.api.MomoCatsEffectSuite

final class RuntimeHttp2ProbeMiddlewareSpec extends MomoCatsEffectSuite:
  private val fallback: HttpApp[IO] = Kleisli(_ => IO.pure(Response[IO](Status.ImATeapot)))
  private val app = RuntimeHttp2ProbeMiddleware[IO](fallback)

  test("reports the directly received protocol only for the authenticated internal probe"):
    val request = Request[IO](
      uri = Uri.unsafeFromString(RuntimeHttp2ProbeMiddleware.Path),
      httpVersion = HttpVersion.`HTTP/2`,
    ).putHeaders(Header.Raw(
      RuntimeHttp2ProbeMiddleware.HeaderName,
      RuntimeHttp2ProbeMiddleware.HeaderValue,
    ))

    for
      response <- app.run(request)
      body <- response.as[String]
    yield
      assertEquals(response.status, Status.Ok)
      assertEquals(parse(body).flatMap(_.hcursor.get[String]("httpVersion")), Right("HTTP/2.0"))
      assertEquals(parse(body).map(_.hcursor.keys.map(_.toSet)), Right(Some(Set("httpVersion"))))

  test("falls through when the probe header is absent"):
    app.run(Request[IO](uri = Uri.unsafeFromString(RuntimeHttp2ProbeMiddleware.Path)))
      .map(response => assertEquals(response.status, Status.ImATeapot))

end RuntimeHttp2ProbeMiddlewareSpec
