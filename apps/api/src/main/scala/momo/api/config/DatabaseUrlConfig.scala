package momo.api.config

import java.net.URI

import cats.syntax.all.*

private[config] object DatabaseUrlConfig:
  /**
   * Convert a postgres:// or postgresql:// URL to a JDBC URL, extracting embedded credentials.
   * Returns (jdbcUrl, userOption, passwordOption). Already-prefixed jdbc:postgresql:// URLs are
   * passed through unchanged.
   */
  private[config] def toJdbcUrl(
      raw: String
  ): Either[Throwable, (String, Option[String], Option[String])] =
    if raw.startsWith("jdbc:postgresql://") then Right((raw, None, None))
    else if raw.startsWith("jdbc:") then
      Left(new IllegalArgumentException(
        "DATABASE_URL must use jdbc:postgresql://, postgres://, or postgresql://"
      ))
    else
      Either.catchNonFatal(URI.create(raw.replaceFirst("^postgres(ql)?://", "postgresql://")))
        .leftMap(error =>
          new IllegalArgumentException("DATABASE_URL must be a valid Postgres URL.", error)
        ).flatMap { uri =>
          Option(uri.getScheme).filter(_ == "postgresql").toRight(new IllegalArgumentException(
            "DATABASE_URL must use jdbc:postgresql://, postgres://, or postgresql://"
          )).flatMap(_ =>
            Option(uri.getHost).filter(_.trim.nonEmpty)
              .toRight(new IllegalArgumentException("DATABASE_URL must include a database host"))
              .map(host => (uri, host))
          )
        }.map { case (uri, host) =>
          val userInfo = Option(uri.getUserInfo)
          val (user, pass) = userInfo match
            case None => (None, None)
            case Some(info) =>
              val parts = info.split(":", 2)
              (Some(parts(0)).filter(_.nonEmpty), if parts.length > 1 then Some(parts(1)) else None)
          val port = if uri.getPort > 0 then s":${uri.getPort}" else ""
          val path = Option(uri.getRawPath).getOrElse("")
          val query = Option(uri.getRawQuery).map(q => s"?$q").getOrElse("")
          val jdbcUrl = s"jdbc:postgresql://$host$port$path$query"
          (jdbcUrl, user, pass)
        }

  private[config] def ensureProdSslMode(
      jdbcUrl: String,
      appEnv: AppEnv,
  ): Either[Throwable, String] =
    if appEnv != AppEnv.Prod then Right(jdbcUrl)
    else
      val sslModes = jdbcQueryParams(jdbcUrl).getOrElse("sslmode", Nil)
      sslModes match
        case _ :: _ :: _ => Left(new IllegalArgumentException(
            "DATABASE_URL sslmode must be specified at most once in prod APP_ENV"
          ))
        case value :: Nil
            if value.equalsIgnoreCase("require") || value.equalsIgnoreCase("verify-ca") ||
              value.equalsIgnoreCase("verify-full") => Right(jdbcUrl)
        case value :: Nil => Left(new IllegalArgumentException(
            s"DATABASE_URL sslmode must be require, verify-ca, or verify-full in prod APP_ENV, got: $value"
          ))
        case Nil => Right(appendJdbcQueryParam(jdbcUrl, "sslmode", "require"))

  private def jdbcQueryParams(jdbcUrl: String): Map[String, List[String]] =
    val queryStart = jdbcUrl.indexOf('?')
    if queryStart < 0 || queryStart == jdbcUrl.length - 1 then Map.empty
    else
      jdbcUrl.substring(queryStart + 1).split("&").iterator.toList.filter(_.nonEmpty)
        .foldLeft(Map.empty[String, List[String]]) { (acc, part) =>
          val key = part.takeWhile(_ != '=')
          val value = part.drop(key.length).stripPrefix("=")
          acc.updated(key, acc.getOrElse(key, Nil) :+ value)
        }

  private def appendJdbcQueryParam(jdbcUrl: String, key: String, value: String): String =
    val separator = if jdbcUrl.contains("?") then "&" else "?"
    s"$jdbcUrl$separator$key=$value"
