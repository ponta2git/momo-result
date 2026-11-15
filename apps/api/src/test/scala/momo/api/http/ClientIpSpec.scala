package momo.api.http

import java.net.InetSocketAddress

import munit.FunSuite
import sttp.model.{Header, Method, QueryParams, Uri}
import sttp.tapir.AttributeKey
import sttp.tapir.model.{ConnectionInfo, ServerRequest}

class ClientIpSpec extends FunSuite:

  test("returns the client identity validated by runtime ingress") {
    val req = request(headers = List(Header("X-Momo-Client-IP", "203.0.113.7")))
    assertEquals(ClientIp.of(req), "203.0.113.7")
  }

  test("ignores client-supplied X-Forwarded-For (spoof-resistant)") {
    val req = request(headers = List(Header("X-Forwarded-For", "1.2.3.4, 5.6.7.8")))
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("validated edge identity wins over external forwarding headers") {
    val req = request(
      headers = List(
        Header("X-Forwarded-For", "1.2.3.4"),
        Header("Fly-Client-IP", "203.0.113.9"),
        Header("X-Momo-Client-IP", "203.0.113.10"),
      )
    )
    assertEquals(ClientIp.of(req), "203.0.113.10")
  }

  test("falls back to remoteAddr for local development without trusted edge identity") {
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

  test("ignores an external Fly-Client-IP without validated edge identity") {
    val req = request(headers = List(Header("Fly-Client-IP", "203.0.113.9")))
    assertEquals(ClientIp.of(req), "unknown")
  }

  test("ignores malformed trusted client identity defensively") {
    val req = request(headers = List(Header("X-Momo-Client-IP", "not-an-ip")))
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
