package momo.api.adapters.discord

import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.net.{Authenticator, CookieHandler, InetSocketAddress, ProxySelector, URI, URLDecoder}
import java.nio.charset.StandardCharsets
import java.util.Optional
import java.util.concurrent.{CompletableFuture, ConcurrentLinkedQueue, Executor}
import javax.net.ssl.{SSLContext, SSLParameters}

import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import com.sun.net.httpserver.HttpServer

import momo.api.MomoCatsEffectSuite
import momo.api.auth.DiscordUser
import momo.api.errors.AppError

/** The production adapter and JDK transport exchange bytes with an owned loopback provider. */
final class JavaDiscordOAuthTransportSpec extends MomoCatsEffectSuite:
  private final case class Received(
      method: String,
      path: String,
      contentType: String,
      authorization: String,
      body: String,
  )

  test("OAuth token exchange and user lookup cross a real local HTTP boundary") {
    provider(200).use { case (client, received) =>
      client.fetchUser("fixture code+with&symbols").map { result =>
        assertEquals(result, Right(DiscordUser("123456789012345678")))
        val requests = received.iterator().asScala.toList
        assertEquals(requests.map(r => r.method -> r.path), List(
          "POST" -> "/api/oauth2/token",
          "GET" -> "/api/users/@me",
        ))
        val token = requests.headOption.getOrElse(fail("missing token request"))
        assertEquals(token.contentType, "application/x-www-form-urlencoded")
        val fields = token.body.split("&").toList.map { field =>
          field.split("=", 2).toList match
            case key :: value :: Nil =>
              URLDecoder.decode(key, StandardCharsets.UTF_8) ->
                URLDecoder.decode(value, StandardCharsets.UTF_8)
            case _ => fail("invalid token form")
        }.toMap
        assertEquals(fields, Map(
          "client_id" -> "fixture-client",
          "client_secret" -> "fixture-secret",
          "grant_type" -> "authorization_code",
          "code" -> "fixture code+with&symbols",
          "redirect_uri" -> "http://127.0.0.1/callback",
        ))
        assertEquals(requests.map(_.authorization), List("", "Bearer fixture-access-token"))
      }
    }
  }

  test("OAuth provider failure over real HTTP does not attempt user lookup") {
    provider(503).use { case (client, received) =>
      client.fetchUser("fixture-code").map { result =>
        assertEquals(result, Left(AppError.DependencyFailed("Discord OAuth provider request failed.")))
        assertEquals(received.iterator().asScala.toList.map(_.path), List("/api/oauth2/token"))
      }
    }
  }

  private def provider(status: Int)
      : Resource[IO, (JavaDiscordOAuthClient[IO], ConcurrentLinkedQueue[Received])] =
    val received = ConcurrentLinkedQueue[Received]()
    for
      server <- Resource.make(IO.blocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val _ = server.createContext("/", exchange => {
          val path = exchange.getRequestURI.getPath
          val _ = received.add(Received(
            exchange.getRequestMethod,
            path,
            Option(exchange.getRequestHeaders.getFirst("Content-Type")).getOrElse(""),
            Option(exchange.getRequestHeaders.getFirst("Authorization")).getOrElse(""),
            String(exchange.getRequestBody.readNBytes(4096), StandardCharsets.UTF_8),
          ))
          val (code, text) = path match
            case "/api/oauth2/token" => status -> """{"access_token":"fixture-access-token"}"""
            case "/api/users/@me" => 200 -> """{"id":"123456789012345678"}"""
            case _ => 404 -> "{}"
          val bytes = text.getBytes(StandardCharsets.UTF_8)
          exchange.getResponseHeaders.add("Content-Type", "application/json")
          exchange.sendResponseHeaders(code, bytes.length.toLong)
          exchange.getResponseBody.write(bytes)
          exchange.close()
        })
        server.start()
        server
      })(server => IO.blocking(server.stop(0)))
      transport <- Resource.fromAutoCloseable(IO.blocking(HttpClient.newHttpClient()))
    yield
      val base = URI.create(s"http://127.0.0.1:${server.getAddress.getPort.toString}")
      val config = JavaDiscordOAuthClient.Config(
        "fixture-client", "fixture-secret", "http://127.0.0.1/callback", "identify",
      )
      (JavaDiscordOAuthClient[IO](config, LoopbackTransport(transport, base)), received)

  /** Test-only route rewrite; every actual network request is constrained to this stub. */
  private final case class LoopbackTransport(delegate: HttpClient, base: URI) extends HttpClient:
    private def local(request: HttpRequest): HttpRequest =
      require(request.uri().getHost == "discord.com")
      HttpRequest.newBuilder(request, (_, _) => true)
        .uri(base.resolve(request.uri().getRawPath)).build()
    override def cookieHandler(): Optional[CookieHandler] = delegate.cookieHandler()
    override def connectTimeout(): Optional[java.time.Duration] = delegate.connectTimeout()
    override def followRedirects(): HttpClient.Redirect = delegate.followRedirects()
    override def proxy(): Optional[ProxySelector] = delegate.proxy()
    override def sslContext(): SSLContext = delegate.sslContext()
    override def sslParameters(): SSLParameters = delegate.sslParameters()
    override def authenticator(): Optional[Authenticator] = delegate.authenticator()
    override def version(): HttpClient.Version = delegate.version()
    override def executor(): Optional[Executor] = delegate.executor()
    override def send[T](request: HttpRequest, handler: HttpResponse.BodyHandler[T]): HttpResponse[T] =
      delegate.send(local(request), handler)
    override def sendAsync[T](request: HttpRequest, handler: HttpResponse.BodyHandler[T])
        : CompletableFuture[HttpResponse[T]] = delegate.sendAsync(local(request), handler)
    override def sendAsync[T](
        request: HttpRequest,
        handler: HttpResponse.BodyHandler[T],
        push: HttpResponse.PushPromiseHandler[T],
    ): CompletableFuture[HttpResponse[T]] = delegate.sendAsync(local(request), handler, push)
