package momo.api.http

import org.http4s.Request
import org.typelevel.ci.CIString

/**
 * Client IP extraction for rate limiting and audit logging.
 *
 * On Fly.io the only trustworthy source of the originating client address is the `Fly-Client-IP`
 * header injected by the Fly edge proxy. Inbound `X-Forwarded-For` (or RFC 7239 `Forwarded`) values
 * are not trustworthy because they can be spoofed by any caller — the edge does not strip
 * client-supplied XFF, it only appends. Trusting XFF would let an attacker rotate the client key
 * and defeat the login rate limiter.
 *
 * Fall back to the connection's remote address when no Fly header is present (local dev,
 * integration tests, or when running outside Fly). As a last resort, return "unknown" so the rate
 * limiter still has a stable bucket key per request.
 */
object ClientIp:
  private val FlyClientIp = CIString("Fly-Client-IP")

  def of[F[_]](request: Request[F]): String = request.headers.get(FlyClientIp)
    .map(_.head.value.trim).filter(_.nonEmpty).orElse(request.remoteAddr.map(_.toString))
    .getOrElse("unknown")
