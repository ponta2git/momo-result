package momo.api.config

import java.net.{URI, URLDecoder}
import java.nio.charset.StandardCharsets

import cats.syntax.all.*

private[config] object DatabaseUrlConfig:
  private val jdbcPrefix = "jdbc:postgresql://"
  private val javaSslFactory = "org.postgresql.ssl.DefaultJavaSSLFactory"
  private val libpqSslFactory = "org.postgresql.ssl.LibPQFactory"
  private val hostnameVerifier = "org.postgresql.ssl.PGjdbcHostnameVerifier"

  /** Convert supported URLs without retaining user information in the JDBC URL or error causes. */
  private[config] def toJdbcUrl(
      raw: String
  ): Either[Throwable, (String, Option[String], Option[String])] =
    if raw.startsWith(jdbcPrefix) then validateJdbcUrl(raw).as((raw, None, None))
    else if raw.startsWith("jdbc:") then unsupportedScheme
    else
      for
        uri <- Either.catchNonFatal(URI.create(raw))
          .leftMap(_ => invalid("DATABASE_URL must be a valid Postgres URL."))
        _ <- Either.cond(
          Option(uri.getScheme).exists(scheme => scheme == "postgres" || scheme == "postgresql"),
          (),
          invalid("DATABASE_URL must use jdbc:postgresql://, postgres://, or postgresql://"),
        )
        host <- validHost(uri)
        credentials <- Option(uri.getRawUserInfo).traverse { info =>
          // Split before decoding: an encoded colon belongs to the username, not the separator.
          val parts = info.split(":", 2)
          for
            user <- decodeUriComponent(parts(0))
            password <- parts.lift(1).traverse(decodeUriComponent)
          yield (Option(user).filter(_.nonEmpty), password)
        }
        port = if uri.getPort >= 0 then s":${uri.getPort}" else ""
        path = Option(uri.getRawPath).filter(_.nonEmpty).getOrElse("/")
        query = Option(uri.getRawQuery).map(value => s"?$value").getOrElse("")
        jdbcUrl = s"$jdbcPrefix$host$port$path$query"
        _ <- Either.cond(
          Option(uri.getRawFragment).isEmpty,
          (),
          invalid("DATABASE_URL must not contain a fragment"),
        )
        _ <- validateJdbcUrl(jdbcUrl)
        (user, password) = credentials.getOrElse((None, None))
      yield (jdbcUrl, user, password)

  private[config] def ensureProdSslMode(
      jdbcUrl: String,
      appEnv: AppEnv,
  ): Either[Throwable, String] =
    if appEnv != AppEnv.Prod then Right(jdbcUrl)
    else
      for
        params <- jdbcQueryParams(jdbcUrl)
        _ <- Either.cond(
          !params.contains("service") && !params.contains("sslfactoryarg"),
          (),
          invalid(
            "DATABASE_URL must not override SSL configuration through service or factory arguments in prod APP_ENV"
          ),
        )
        mode <- singleParam(params, "sslmode")
        _ <- Either.cond(
          mode.forall(_.equalsIgnoreCase("verify-full")),
          (),
          invalid("DATABASE_URL sslmode must be verify-full in prod APP_ENV"),
        )
        ssl <- singleParam(params, "ssl")
        _ <- Either.cond(
          ssl.forall(value => value.isEmpty || value.equalsIgnoreCase("true")),
          (),
          invalid("DATABASE_URL ssl must not disable TLS in prod APP_ENV"),
        )
        factory <- singleParam(params, "sslfactory")
        _ <- Either.cond(
          factory.forall(value => value == javaSslFactory || value == libpqSslFactory),
          (),
          invalid("DATABASE_URL must use a certificate-validating SSL factory in prod APP_ENV"),
        )
        verifier <- singleParam(params, "sslhostnameverifier")
        _ <- Either.cond(
          verifier.forall(_ == hostnameVerifier),
          (),
          invalid("DATABASE_URL must use the standard SSL hostname verifier in prod APP_ENV"),
        )
        rootCertificate <- singleParam(params, "sslrootcert")
        strictUrl = if mode.isEmpty then appendJdbcQueryParam(jdbcUrl, "sslmode", "verify-full")
        else jdbcUrl
        // The runtime ships the JVM trust store. Explicit root certificates use pgJDBC's factory.
        trustedUrl = if factory.isEmpty && rootCertificate.isEmpty then
          appendJdbcQueryParam(strictUrl, "sslfactory", javaSslFactory)
        else strictUrl
      yield trustedUrl

  private def validHost(uri: URI): Either[Throwable, String] =
    for
      host <- Option(uri.getHost).filter(_.nonEmpty)
        .toRight(invalid("DATABASE_URL must include a database host"))
      _ <- Either.cond(
        uri.getPort == -1 || (uri.getPort > 0 && uri.getPort <= 65535),
        (),
        invalid("DATABASE_URL must use a valid database port"),
      )
    yield host

  private def validateJdbcUrl(jdbcUrl: String): Either[Throwable, Unit] =
    val server = jdbcUrl.drop(jdbcPrefix.length).takeWhile(_ != '?')
    val pathStart = server.indexOf('/')
    for
      _ <- Either.cond(
        jdbcUrl.startsWith(jdbcPrefix) && !jdbcUrl.contains('#') &&
          !jdbcUrl.exists(character => Character.isISOControl(character)),
        (),
        invalid("DATABASE_URL must be a valid Postgres URL without a fragment"),
      )
      _ <- Either.cond(
        pathStart > 0 && server.indexOf('/', pathStart + 1) < 0,
        (),
        invalid("DATABASE_URL must include a database host and a single database path"),
      )
      _ <- server.take(pathStart).split(",", -1).toList.traverse_ { address =>
        for
          uri <- Either.catchNonFatal(URI.create(s"postgresql://$address/"))
            .leftMap(_ => invalid("DATABASE_URL must include a valid database host"))
          host <- validHost(uri)
          port = if uri.getPort >= 0 then s":${uri.getPort}" else ""
          _ <- Either.cond(
            Option(uri.getRawUserInfo).isEmpty && address == s"$host$port",
            (),
            invalid("JDBC DATABASE_URL must not contain user information or an invalid port"),
          )
        yield ()
      }
      _ <- decodeQueryValue(server.drop(pathStart + 1))
      _ <- jdbcQueryParams(jdbcUrl)
    yield ()

  private def jdbcQueryParams(jdbcUrl: String): Either[Throwable, Map[String, List[String]]] =
    val queryStart = jdbcUrl.indexOf('?')
    if queryStart < 0 then Right(Map.empty)
    else
      jdbcUrl.substring(queryStart + 1).split("&", -1).iterator.filter(_.nonEmpty).toList
        .traverse { part =>
          val separator = part.indexOf('=')
          val key = if separator < 0 then part else part.take(separator)
          val rawValue = if separator < 0 then "" else part.substring(separator + 1)
          // pgJDBC decodes values, but leaves property names unchanged.
          decodeQueryValue(rawValue).map(key -> _)
        }.map(_.groupMap(_._1)(_._2))

  private def singleParam(
      params: Map[String, List[String]],
      name: String,
  ): Either[Throwable, Option[String]] = params.getOrElse(name, Nil) match
    case Nil => Right(None)
    case value :: Nil => Right(Some(value))
    case _ => Left(invalid(s"DATABASE_URL $name must be specified at most once in prod APP_ENV"))

  private def decodeUriComponent(value: String): Either[Throwable, String] =
    decodeQueryValue(value.replace("+", "%2B"))

  private def decodeQueryValue(value: String): Either[Throwable, String] =
    Either.catchNonFatal(URLDecoder.decode(value, StandardCharsets.UTF_8))
      .leftMap(_ => invalid("DATABASE_URL must use valid percent encoding"))

  private def appendJdbcQueryParam(jdbcUrl: String, key: String, value: String): String =
    val separator = if jdbcUrl.contains("?") then "&" else "?"
    s"$jdbcUrl$separator$key=$value"

  private def invalid(message: String): IllegalArgumentException =
    new IllegalArgumentException(message)

  private def unsupportedScheme: Either[Throwable, Nothing] = Left(invalid(
    "DATABASE_URL must use jdbc:postgresql://, postgres://, or postgresql://"
  ))
