package momo.api.config

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

object RedirectPath:
  def sanitize(value: String): Option[String] = Option.when(isSafe(value))(value)

  def isSafe(value: String): Boolean = value.startsWith("/") && !value.startsWith("//") &&
    !value.exists(ch => ch == '\r' || ch == '\n')

  def encodeQueryValue(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)
