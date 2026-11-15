package momo.api.http

import java.nio.file.Path

import cats.data.Kleisli
import cats.effect.IO
import cats.syntax.all.*
import com.comcast.ip4s.{IpAddress, Port, SocketAddress}
import fs2.Stream
import org.http4s.{Header, HttpApp, Method, Request, Response, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv, IngressConfig}

final class RuntimeIngressMiddlewareSpec extends MomoCatsEffectSuite:
  private val credential = "test-only-origin-credential-32-bytes"
  private val origin = Header.Raw(RuntimeIngressMiddleware.OriginHeader, credential)
  private val client = Header.Raw(RuntimeIngressMiddleware.ClientIpHeader, "203.0.113.7")
  private val host = Header.Raw(CIString("Host"), "example.com:443")
  private val appConfig = IngressConfig.load[IO](
    Map(
      "MOMO_CANONICAL_HOST" -> "example.com",
      "MOMO_ORIGIN_LOCK_TOKEN" -> credential,
    ),
    AppEnv.Prod
  ).map(ingress =>
    AppConfig(
      AppEnv.Prod,
      "0.0.0.0",
      8080,
      Path.of("/tmp"),
      Nil,
      ingress = ingress,
    )
  )

  private val fallback: HttpApp[IO] = Kleisli(request =>
    IO.pure(
      Response[IO](
        Status.Ok
      ).withEntity(request.headers.headers.map(_.name.toString).sorted.mkString(","))
    )
  )

  private def request(path: String): Request[IO] = Request[IO](uri = Uri.unsafeFromString(path))
    .putHeaders(host)

  private def loopback(request: Request[IO]): Request[IO] = request.withAttribute(
    Request.Keys.ConnectionInfo,
    Request.Connection(
      SocketAddress(IpAddress.fromString("127.0.0.1").get, Port.fromInt(8080).get),
      SocketAddress(IpAddress.fromString("127.0.0.1").get, Port.fromInt(40000).get),
      secure = false,
    ),
  )

  test(
    "authenticated edge identity survives while caller-supplied forwarding and credentials are stripped"
  ):
    appConfig.flatMap { config =>
      RuntimeIngressMiddleware[IO](config)(fallback).run(request("/api/example").putHeaders(
        origin,
        client,
        Header.Raw(CIString("Fly-Client-IP"), "198.51.100.8"),
        Header.Raw(CIString("X-Forwarded-For"), "127.0.0.1"),
        Header.Raw(RuntimeHttp2ProbeMiddleware.HeaderName, RuntimeHttp2ProbeMiddleware.HeaderValue),
      )).flatMap(response =>
        response.as[String].map { body =>
          assertEquals(response.status, Status.Ok)
          assert(body.contains("X-Momo-Client-IP"))
          assert(!body.contains("Origin-Lock"))
          assert(!body.contains("Fly-Client-IP"))
          assert(!body.contains("X-Forwarded-For"))
          assert(!body.contains("Runtime-Probe"))
        }
      )
    }

  test("missing, invalid and ambiguous origin or Host are rejected before decoding or routing"):
    for
      config <- appConfig
      pulls <- IO.ref(0)
      calls <- IO.ref(0)
      app = RuntimeIngressMiddleware[IO](config)(Kleisli(_ =>
        calls.update(_ + 1).as(Response[IO](Status.Ok))
      ))
      base = request("/api/example").withBodyStream(Stream.exec(pulls.update(_ + 1)))
      requests = List(
        base.putHeaders(client),
        base.putHeaders(client, Header.Raw(RuntimeIngressMiddleware.OriginHeader, "wrong")),
        base.putHeaders(client).withHeaders(base.headers.headers ++ List(origin, origin, client)),
        base.putHeaders(origin, client, Header.Raw(CIString("Host"), "other.example")),
        base.withHeaders(List(host, host, origin, client)),
        base.withUri(Uri.unsafeFromString("https://other.example/api/example")).putHeaders(
          origin,
          client
        ),
      )
      responses <- requests.traverse(app.run)
      observed <- (pulls.get, calls.get).tupled
    yield
      assert(responses.forall(_.status === Status.MisdirectedRequest))
      assert(responses.forall(_.headers.get(CIString("Cache-Control")).exists(_.head.value ==
        "private, no-store")))
      assert(responses.forall(_.headers.get(CIString("X-Content-Type-Options")).nonEmpty))
      assertEquals(observed, (0, 0))

  test("external ingress requires one valid edge client IP"):
    appConfig.flatMap { config =>
      val app = RuntimeIngressMiddleware[IO](config)(fallback)
      val base = request("/api/example").putHeaders(origin)
      List(
        base,
        base.putHeaders(Header.Raw(RuntimeIngressMiddleware.ClientIpHeader, "invalid")),
        base.withHeaders(base.headers.headers ++ List(client, client)),
      ).traverse(app.run).map(responses => assert(responses.forall(_.status === Status.BadRequest)))
    }

  test("only exact GET health bypasses origin authentication and remains uncacheable"):
    appConfig.flatMap { config =>
      val app = RuntimeIngressMiddleware[IO](config)(fallback)
      for
        public <- app.run(request("/healthz"))
        details <- app.run(request("/healthz/details"))
        post <- app.run(request("/healthz").withMethod(Method.POST))
        head <- app.run(request("/healthz").withMethod(Method.HEAD))
      yield
        assertEquals(public.status, Status.Ok)
        assertEquals(
          public.headers.get(CIString("Cache-Control")).map(_.head.value),
          Some("private, no-store")
        )
        assertEquals(details.status, Status.MisdirectedRequest)
        assertEquals(post.status, Status.MisdirectedRequest)
        assertEquals(head.status, Status.MisdirectedRequest)
    }

  test("protocol probe requires origin authentication and an actual loopback peer"):
    appConfig.flatMap { config =>
      val app = RuntimeIngressMiddleware[IO](config)(RuntimeHttp2ProbeMiddleware[IO](fallback))
      val probe = request(RuntimeHttp2ProbeMiddleware.Path).putHeaders(
        Header.Raw(RuntimeHttp2ProbeMiddleware.HeaderName, RuntimeHttp2ProbeMiddleware.HeaderValue)
      )
      for
        external <- app.run(probe.putHeaders(
          origin,
          client,
          Header.Raw(CIString("X-Forwarded-For"), "127.0.0.1")
        ))
        unauthenticated <- app.run(loopback(probe))
        local <- app.run(loopback(probe).putHeaders(origin))
        body <- local.as[String]
      yield
        assertEquals(external.status, Status.NotFound)
        assertEquals(unauthenticated.status, Status.MisdirectedRequest)
        assertEquals(local.status, Status.Ok)
        assert(body.contains("httpVersion"))
    }

  test("development strips spoofed edge identity and never exposes the protocol probe remotely"):
    appConfig.flatMap { config =>
      val local = config.copy(appEnv = AppEnv.Dev, ingress = None)
      val app = RuntimeIngressMiddleware[IO](local)(RuntimeHttp2ProbeMiddleware[IO](fallback))
      app.run(request(RuntimeHttp2ProbeMiddleware.Path).putHeaders(
        client,
        Header.Raw(RuntimeHttp2ProbeMiddleware.HeaderName, RuntimeHttp2ProbeMiddleware.HeaderValue)
      )).flatMap(_.as[String]).map { body =>
        assert(!body.contains("httpVersion"))
        assert(!body.contains("X-Momo-Client-IP"))
      }
    }
