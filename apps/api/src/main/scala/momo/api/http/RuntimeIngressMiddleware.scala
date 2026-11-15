package momo.api.http

import cats.data.Kleisli
import cats.effect.Sync
import cats.syntax.all.*
import com.comcast.ip4s.IpAddress
import org.http4s.headers.Host
import org.http4s.{Header, HttpApp, HttpVersion, Method, Request, Response, Status}
import org.typelevel.ci.CIString

import momo.api.config.{AppConfig, AppEnv, IngressConfig}

/** Runs before the protocol probe and application; rejected requests never decode a body. */
private[api] object RuntimeIngressMiddleware:
  val OriginHeader: CIString = CIString("X-Momo-Origin-Lock")
  val ClientIpHeader: CIString = CIString("X-Momo-Client-IP")
  private val UntrustedForwardingHeaders = Set(
    OriginHeader,
    ClientIpHeader,
    CIString("Forwarded"),
    CIString("X-Forwarded-For"),
    CIString("X-Forwarded-Host"),
    CIString("X-Forwarded-Proto"),
    CIString("Fly-Client-IP"),
    CIString("CF-Connecting-IP"),
    RuntimeHttp2ProbeMiddleware.HeaderName,
  )

  def apply[F[_]: Sync](config: AppConfig)(http: HttpApp[F]): HttpApp[F] = Kleisli { request =>
    val loopback = isLoopback(request)
    val clean = request.filterHeaders(header => !UntrustedForwardingHeaders.contains(header.name))
    val result = config.ingress match
      case None if config.appEnv != AppEnv.Prod =>
        http.run(localProbe(request, clean, loopback))
      case None => reject[F](Status.ServiceUnavailable)
      case Some(ingress) =>
        if !allowedHost(request, ingress) then reject[F](Status.MisdirectedRequest)
        else if request.method === Method.GET && request.uri.path.renderString == "/healthz" then
          http.run(clean)
        else if !singleHeader(request, OriginHeader).exists(ingress.acceptsToken) then
          reject[F](Status.MisdirectedRequest)
        else if internalPath(request) && !loopback then reject[F](Status.NotFound)
        else
          trustedClientIp(request, loopback) match
            case None => reject[F](Status.BadRequest)
            case Some(ip) =>
              val trusted = clean.putHeaders(Header.Raw(ClientIpHeader, ip.toString))
              http.run(localProbe(request, trusted, loopback))
    result.map(SecurityHeadersMiddleware.secureResponse(config.appEnv, _))
  }

  private[http] def isLoopback[F[_]](request: Request[F]): Boolean =
    request.remoteAddr.exists(_.isLoopback)

  private def singleHeader[F[_]](request: Request[F], name: CIString): Option[String] =
    request.headers.headers.filter(_.name === name) match
      case List(header) => Some(header.value)
      case _ => None

  private def allowedHost[F[_]](request: Request[F], config: IngressConfig): Boolean =
    val authority = request.uri.authority
    val uriHost = authority.map(value => IngressConfig.normalizeHost(value.host.value))
    authority.forall(_.userInfo.isEmpty) &&
    (request.headers.headers
      .filter(_.name === CIString("Host")) match
      // Ember decodes HTTP/2 :authority into the URI, without manufacturing a Host header.
      case Nil if request.httpVersion === HttpVersion.`HTTP/2` =>
        uriHost.exists(config.allowedHosts.contains)
      case List(header) => Host.parse(header.value).toOption.exists { host =>
          val name = IngressConfig.normalizeHost(host.host)
          config.allowedHosts.contains(name) && uriHost.forall(_ == name)
        }
      case _ => false)

  private def trustedClientIp[F[_]](request: Request[F], loopback: Boolean): Option[IpAddress] =
    request.headers.headers.filter(_.name === ClientIpHeader) match
      case Nil if loopback => request.remoteAddr
      case List(header) => IpAddress.fromString(header.value)
      case _ => None

  private def internalPath[F[_]](request: Request[F]): Boolean =
    HttpRequestPaths.segments(request) match
      case "api" :: "__momo_runtime" :: _ => true
      case "__momo_runtime" :: _ => true
      case _ => false

  private def localProbe[F[_]](
      original: Request[F],
      clean: Request[F],
      loopback: Boolean,
  ): Request[F] =
    if loopback && singleHeader(original, RuntimeHttp2ProbeMiddleware.HeaderName)
        .contains(RuntimeHttp2ProbeMiddleware.HeaderValue)
    then
      clean.putHeaders(Header.Raw(
        RuntimeHttp2ProbeMiddleware.HeaderName,
        RuntimeHttp2ProbeMiddleware.HeaderValue,
      ))
    else clean

  private def reject[F[_]: Sync](status: Status): F[Response[F]] = Response[F](status).pure[F]
