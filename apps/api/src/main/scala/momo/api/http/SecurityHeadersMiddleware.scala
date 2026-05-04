package momo.api.http

import cats.data.Kleisli
import cats.effect.Sync
import cats.syntax.all.*
import org.http4s.{Header, HttpApp as Http4sApp}
import org.typelevel.ci.CIString

import momo.api.config.AppEnv

/**
 * Minimum baseline of security response headers for all routes (SPA + API).
 *
 *   - `X-Content-Type-Options: nosniff` — block MIME sniffing.
 *   - `X-Frame-Options: DENY` — defence-in-depth against clickjacking; the CSP
 *     `frame-ancestors 'none'` directive is the modern equivalent and is also set, but legacy
 *     intermediaries still honour XFO.
 *   - `Referrer-Policy: no-referrer` — outbound links never leak the URL of in-app pages (which
 *     include OAuth flow markers).
 *   - `Permissions-Policy` — explicitly opt out of powerful APIs the app does not use, so a future
 *     XSS or third-party script cannot enable them.
 *   - `Strict-Transport-Security` — pin TLS in production. Skipped in non-prod so local `http://`
 *     development is not poisoned.
 *   - `Content-Security-Policy` — restrict the SPA bundle's privileges. Tailwind requires
 *     `'unsafe-inline'` for injected `<style>` blocks until we adopt a build that nonces them; that
 *     is an accepted MVP trade-off and is documented in `docs/architecture.md` (security section).
 *     `script-src 'self'` rules out third-party JS entirely.
 *
 * This middleware is intentionally orthogonal to [[RequestIdMiddleware]]: it inspects nothing about
 * the request, it only annotates responses, and any header already set by an inner handler is
 * preserved (so OAuth `Location`, image responses etc. are not clobbered).
 */
object SecurityHeadersMiddleware:
  private val Nosniff = Header.Raw(CIString("X-Content-Type-Options"), "nosniff")
  private val FrameDeny = Header.Raw(CIString("X-Frame-Options"), "DENY")
  private val Referrer = Header.Raw(CIString("Referrer-Policy"), "no-referrer")
  private val Permissions = Header.Raw(
    CIString("Permissions-Policy"),
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  )
  private val Hsts = Header
    .Raw(CIString("Strict-Transport-Security"), "max-age=31536000; includeSubDomains")

  /**
   * CSP for SPA + API on the same origin. Discord OAuth happens via 302 redirects so it does not
   * require `connect-src`/`frame-src` entries. Image previews use `data:` and `blob:` URLs from the
   * upload flow.
   */
  private val Csp = Header.Raw(
    CIString("Content-Security-Policy"),
    List(
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ).mkString("; "),
  )

  def apply[F[_]: Sync](appEnv: AppEnv)(http: Http4sApp[F]): Http4sApp[F] =
    val baseHeaders = List(Nosniff, FrameDeny, Referrer, Permissions, Csp)
    val headers = if appEnv == AppEnv.Prod then baseHeaders :+ Hsts else baseHeaders

    Kleisli { request =>
      http.run(request).map { response =>
        val present = response.headers.headers.map(_.name).toSet
        val toAdd = headers.filterNot(h => present.contains(h.name))
        if toAdd.isEmpty then response else response.putHeaders(toAdd.map(Header.ToRaw.rawToRaw)*)
      }
    }
