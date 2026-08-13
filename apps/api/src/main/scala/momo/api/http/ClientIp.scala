package momo.api.http

import com.comcast.ip4s.IpAddress
import sttp.tapir.model.ServerRequest

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
  private val FlyClientIpHeader = "Fly-Client-IP"

  def of(request: ServerRequest): String = request.header(FlyClientIpHeader)
    .map(_.trim).flatMap(IpAddress.fromString).map(_.toString)
    .orElse(request.connectionInfo.remote.map(remote =>
      Option(remote.getAddress).map(_.getHostAddress).getOrElse(remote.getHostString)
    ))
    .getOrElse("unknown")
