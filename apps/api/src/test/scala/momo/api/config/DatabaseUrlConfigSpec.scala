package momo.api.config

import java.util.Properties

import scala.jdk.CollectionConverters.*

import munit.FunSuite
import org.postgresql.Driver

final class DatabaseUrlConfigSpec extends FunSuite:
  private val databaseUrl = "jdbc:postgresql://db.example.com/momo"
  private val standardFactory = "org.postgresql.ssl.DefaultJavaSSLFactory"

  test("URI credentials preserve encoded separators and literal plus signs"):
    val result = DatabaseUrlConfig.toJdbcUrl(
      "postgres://user%3Aname:p%3Aa+ss%2Bword@db.example.com:5432/momo"
    )
    assertEquals(
      result,
      Right(("jdbc:postgresql://db.example.com:5432/momo", Some("user:name"), Some("p:a+ss+word"))),
    )

  test("supported URLs preserve IPv6 and JDBC failover hosts"):
    List(
      "postgresql://[::1]:5432/momo" -> "jdbc:postgresql://[::1]:5432/momo",
      "postgres://db.example.com" -> "jdbc:postgresql://db.example.com/",
      "jdbc:postgresql://db.example.com:5432,[::1]:5433/momo" ->
        "jdbc:postgresql://db.example.com:5432,[::1]:5433/momo",
    ).foreach { case (input, expected) =>
      assertEquals(DatabaseUrlConfig.toJdbcUrl(input).map(_._1), Right(expected))
    }

  test("invalid database authorities, fragments and percent encoding fail without raw input"):
    List(
      "postgres://user:do-not-log@db.example.com/momo#fragment",
      "postgres://user:do-not-log@db.example.com:0/momo",
      "postgres://user:do-not-log@db.example.com:65536/momo",
      "jdbc:postgresql://user:do-not-log@db.example.com/momo",
      "jdbc:postgresql://db.example.com/momo/extra?password=do-not-log",
      "jdbc:postgresql://db.example.com/momo?password=do-not-log%ZZ",
      "jdbc:postgresql://db.example.com/momo?password=do-not-log#fragment",
    ).foreach { input =>
      val result = DatabaseUrlConfig.toJdbcUrl(input)
      assert(result.isLeft)
      result.left.foreach { error =>
        assert(!error.getMessage.contains("do-not-log"))
        assert(Option(error.getCause).isEmpty)
      }
    }

  test("production defaults reach pgJDBC as certificate-validating TLS with hostname verification"):
    val properties = effectiveProperties(secure(databaseUrl))
    assertEquals(properties.getProperty("sslmode"), "verify-full")
    assertEquals(properties.getProperty("sslfactory"), standardFactory)

  test("encoded secure SSL mode values use the same interpretation as pgJDBC"):
    val properties = effectiveProperties(secure(s"$databaseUrl?sslmode=verify%2Dfull"))
    assertEquals(properties.getProperty("sslmode"), "verify-full")
    assertEquals(properties.getProperty("sslfactory"), standardFactory)

  test("SSL property names remain literal just as in pgJDBC"):
    val properties = effectiveProperties(secure(s"$databaseUrl?%73slmode=disable"))
    assertEquals(properties.getProperty("%73slmode"), "disable")
    assertEquals(properties.getProperty("sslmode"), "verify-full")

  test("production rejects encrypted connections that do not verify both certificate and hostname"):
    List("disable", "allow", "prefer", "require", "verify-ca", "requ%69re", "do-not-log")
      .foreach { mode =>
        val result = DatabaseUrlConfig.ensureProdSslMode(s"$databaseUrl?sslmode=$mode", AppEnv.Prod)
        assert(result.isLeft)
        assert(result.left.forall(error => !error.getMessage.contains("do-not-log")))
      }

  test("production rejects configuration that can replace TLS validation"):
    List(
      "sslfactory=org.postgresql.ssl.NonValidatingFactory",
      "sslfactory=org.postgresql.ssl.NonValidating%46actory",
      "sslhostnameverifier=example.TrustEveryHost",
      "service=external-settings",
      "sslfactoryarg=unreviewed-settings",
      "ssl=false",
      "sslmode=verify-full&sslmode=disable",
      "sslhostnameverifier=one&sslhostnameverifier=two",
    ).foreach { query =>
      assert(DatabaseUrlConfig.ensureProdSslMode(s"$databaseUrl?$query", AppEnv.Prod).isLeft)
    }

  test("explicit trust roots and the standard hostname verifier remain supported"):
    val query = "sslmode=verify-full&sslrootcert=/etc/momo/root.crt" +
      "&sslhostnameverifier=org.postgresql.ssl.PGjdbcHostnameVerifier"
    val url = s"$databaseUrl?$query"
    assertEquals(DatabaseUrlConfig.ensureProdSslMode(url, AppEnv.Prod), Right(url))
    val properties = effectiveProperties(secure(url))
    assertEquals(properties.getProperty("sslrootcert"), "/etc/momo/root.crt")

  private def secure(url: String): String = DatabaseUrlConfig.ensureProdSslMode(url, AppEnv.Prod)
    .fold(error => fail(error.getMessage), identity)

  private def effectiveProperties(url: String): Properties =
    val defaults = new Properties()
    // Supplying a password prevents the parser from consulting a developer's .pgpass file.
    defaults.putAll(Map("user" -> "test-user", "password" -> "test-password").asJava)
    Option(Driver.parseURL(url, defaults)).getOrElse(fail("pgJDBC rejected the validated URL"))

end DatabaseUrlConfigSpec
