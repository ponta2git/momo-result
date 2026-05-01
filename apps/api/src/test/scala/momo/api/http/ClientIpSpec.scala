package momo.api.http

import cats.effect.IO
import com.comcast.ip4s.IpAddress
import munit.CatsEffectSuite
import org.http4s.{Header, Method, Request}
import org.http4s.implicits.uri
import org.typelevel.ci.CIString

class ClientIpSpec extends CatsEffectSuite:

  test("returns Fly-Client-IP when present") {
    val req = Request[IO](Method.GET, uri"/healthz")
      .putHeaders(Header.Raw(CIString("Fly-Client-IP"), "203.0.113.7"))
    assertEquals(ClientIp.of(req), "203.0.113.7")
  }

  test("ignores client-supplied X-Forwarded-For (spoof-resistant)") {
    val req = Request[IO](Method.GET, uri"/healthz")
      .putHeaders(Header.Raw(CIString("X-Forwarded-For"), "1.2.3.4, 5.6.7.8"))
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("Fly-Client-IP wins over X-Forwarded-For") {
    val req = Request[IO](Method.GET, uri"/healthz").putHeaders(
      Header.Raw(CIString("X-Forwarded-For"), "1.2.3.4"),
      Header.Raw(CIString("Fly-Client-IP"), "203.0.113.9"),
    )
    assertEquals(ClientIp.of(req), "203.0.113.9")
  }

  test("falls back to remoteAddr when no Fly header present") {
    val req = Request[IO](Method.GET, uri"/healthz").withAttribute(
      org.http4s.Request.Keys.ConnectionInfo,
      org.http4s.Request.Connection(
        local = com.comcast.ip4s.SocketAddress(
          IpAddress.fromString("127.0.0.1").get,
          com.comcast.ip4s.Port.fromInt(8080).get,
        ),
        remote = com.comcast.ip4s.SocketAddress(
          IpAddress.fromString("198.51.100.5").get,
          com.comcast.ip4s.Port.fromInt(54321).get,
        ),
        secure = false,
      ),
    )
    assertEquals(ClientIp.of(req), "198.51.100.5")
  }

  test("returns 'unknown' when no signal at all") {
    val req = Request[IO](Method.GET, uri"/healthz")
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("trims and ignores empty Fly-Client-IP") {
    val req = Request[IO](Method.GET, uri"/healthz")
      .putHeaders(Header.Raw(CIString("Fly-Client-IP"), "   "))
    assertEquals(ClientIp.of(req), "unknown")
  }
