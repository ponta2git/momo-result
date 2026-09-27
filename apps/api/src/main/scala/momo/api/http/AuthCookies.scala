package momo.api.http

import cats.syntax.all.*
import sttp.model.headers.Cookie
import sttp.tapir.model.ServerRequest

/** An ambiguous credential must not depend on header order or intermediary cookie merging. */
private[http] object AuthCookies:
  def value(cookies: Seq[Cookie], name: String): Option[String] =
    val values = cookies.iterator.filter(_.name == name).map(_.value)
    values.nextOption().filter(_ => !values.hasNext)

  def value(request: ServerRequest, name: String): Option[String] = request.headers
    .filter(_.name.equalsIgnoreCase("Cookie")).toList
    .traverse(header => Cookie.parse(header.value).toOption)
    .flatMap(cookies => value(cookies.flatten, name))
