package momo.api.http

import cats.data.Kleisli
import cats.effect.IO
import com.comcast.ip4s.{IpAddress, Port, SocketAddress}
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
    ).withAttribute(
      Request.Keys.ConnectionInfo,
      Request.Connection(
        SocketAddress(IpAddress.fromString("127.0.0.1").get, Port.fromInt(8080).get),
        SocketAddress(IpAddress.fromString("127.0.0.1").get, Port.fromInt(40000).get),
        secure = false,
      )
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
      val decoded = parse(body).toOption.get.hcursor
      assert(decoded.get[Long]("startedNanos").toOption.get <
        decoded.get[Long]("finishedNanos").toOption.get)
      assertEquals(
        decoded.keys.map(_.toSet),
        Some(Set(
          "httpVersion",
          "startedNanos",
          "finishedNanos",
        ))
      )

  test("falls through when the probe header is absent"):
    app.run(Request[IO](uri = Uri.unsafeFromString(RuntimeHttp2ProbeMiddleware.Path)))
      .map(response => assertEquals(response.status, Status.ImATeapot))

  test("does not trust a probe header without a loopback transport peer"):
    app.run(Request[IO](uri = Uri.unsafeFromString(RuntimeHttp2ProbeMiddleware.Path))
      .putHeaders(Header.Raw(
        RuntimeHttp2ProbeMiddleware.HeaderName,
        RuntimeHttp2ProbeMiddleware.HeaderValue
      )))
      .map(response => assertEquals(response.status, Status.ImATeapot))

end RuntimeHttp2ProbeMiddlewareSpec
