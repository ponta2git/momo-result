package momo.api.http

import java.net.InetSocketAddress

import munit.FunSuite
import sttp.model.{Header, Method, QueryParams, Uri}
import sttp.tapir.AttributeKey
import sttp.tapir.model.{ConnectionInfo, ServerRequest}

class ClientIpSpec extends FunSuite:

  test("returns Fly-Client-IP when present") {
    val req = request(headers = List(Header("Fly-Client-IP", "203.0.113.7")))
    assertEquals(ClientIp.of(req), "203.0.113.7")
  }

  test("ignores client-supplied X-Forwarded-For (spoof-resistant)") {
    val req = request(headers = List(Header("X-Forwarded-For", "1.2.3.4, 5.6.7.8")))
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("Fly-Client-IP wins over X-Forwarded-For") {
    val req = request(
      headers = List(
        Header("X-Forwarded-For", "1.2.3.4"),
        Header("Fly-Client-IP", "203.0.113.9"),
      )
    )
    assertEquals(ClientIp.of(req), "203.0.113.9")
  }

  test("falls back to remoteAddr when no Fly header present") {
    val req = request(
      connectionInfo = ConnectionInfo(
        local = None,
        remote = Some(new InetSocketAddress("198.51.100.5", 54321)),
        secure = Some(false),
      )
    )
    assertEquals(ClientIp.of(req), "198.51.100.5")
  }

  test("returns 'unknown' when no signal at all") {
    val req = request()
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("trims and ignores empty Fly-Client-IP") {
    val req = request(headers = List(Header("Fly-Client-IP", "   ")))
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("ignores malformed Fly-Client-IP values") {
    val req = request(headers = List(Header("Fly-Client-IP", "not-an-ip")))
    assertEquals(ClientIp.of(req), "unknown")
  }

  private def request(): ServerRequest = request(Nil, ConnectionInfo.NoInfo)
  private def request(headers: Seq[Header]): ServerRequest = request(headers, ConnectionInfo.NoInfo)
  private def request(connectionInfo: ConnectionInfo): ServerRequest = request(Nil, connectionInfo)
  private def request(headers: Seq[Header], connectionInfo: ConnectionInfo): ServerRequest =
    TestServerRequest(headers, connectionInfo, ())

  private final case class TestServerRequest(
      headers: Seq[Header],
      connectionInfo: ConnectionInfo,
      underlying: Any,
  ) extends ServerRequest:
    override val protocol: String = "HTTP/1.1"
    override val pathSegments: List[String] = List("healthz")
    override val queryParameters: QueryParams = QueryParams()
    override val method: Method = Method.GET
    override val uri: Uri = Uri.unsafeParse("http://localhost/healthz")
    override def attribute[T](key: AttributeKey[T]): Option[T] = None
    override def attribute[T](key: AttributeKey[T], value: T): ServerRequest = this
    override def withUnderlying(value: Any): ServerRequest = copy(underlying = value)
