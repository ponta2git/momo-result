package momo.api.http

import com.comcast.ip4s.IpAddress
import sttp.tapir.model.ServerRequest

/**
 * Client IP extraction for rate limiting and audit logging.
 *
 * RuntimeIngressMiddleware authenticates the edge, validates and replaces X-Momo-Client-IP,
 * and strips every external forwarding header before the application can reach this helper.
 * Fly-Client-IP identifies the edge connection, not necessarily the browser behind it.
 *
 * Fall back to the connection's remote address when no trusted edge header is present (local dev,
 * integration tests, or when running outside Fly). As a last resort, return "unknown" so the rate
 * limiter still has a stable bucket key per request.
 */
object ClientIp:
  def of(request: ServerRequest): String =
    request.header(RuntimeIngressMiddleware.ClientIpHeader.toString)
      .map(_.trim).flatMap(IpAddress.fromString).map(_.toString)
      .orElse(request.connectionInfo.remote.map(remote =>
        Option(remote.getAddress).map(_.getHostAddress).getOrElse(remote.getHostString)
      ))
      .getOrElse("unknown")
