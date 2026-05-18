package momo.api.config

import cats.effect.IO
import cats.syntax.all.*
import munit.CatsEffectSuite

class AppConfigSpec extends CatsEffectSuite:
  private val prodEnv: Map[String, String] = Map(
    "APP_ENV" -> "prod",
    "DATABASE_URL" -> "postgres://u:p@db.example.com/momo?sslmode=require",
    "REDIS_URL" -> "redis://localhost:6379",
    "DISCORD_CLIENT_ID" -> "client-id",
    "DISCORD_CLIENT_SECRET" -> "client-secret",
    "DISCORD_REDIRECT_URI" -> "https://example.com/api/auth/callback",
    "AUTH_STATE_SIGNING_KEY" -> "state-signing-key",
  )

  private def load(env: Map[String, String]): IO[Either[Throwable, AppConfig]] = AppConfig
    .loadFromEnv[IO](env).attempt

  private def parsedDatabaseUrl(raw: String): (String, Option[String], Option[String]) = AppConfig
    .toJdbcUrl(raw)
    .fold(error => fail(s"expected valid DATABASE_URL: ${error.getMessage}"), identity)

  test("toJdbcUrl: converts postgres:// URL and extracts credentials") {
    val (url, user, pass) = parsedDatabaseUrl("postgres://summit:summit@localhost:5433/summit")
    assertEquals(url, "jdbc:postgresql://localhost:5433/summit")
    assertEquals(user, Some("summit"))
    assertEquals(pass, Some("summit"))
  }

  test("toJdbcUrl: converts postgresql:// URL") {
    val (url, user, pass) = parsedDatabaseUrl("postgresql://user:secret@db.example.com/mydb")
    assertEquals(url, "jdbc:postgresql://db.example.com/mydb")
    assertEquals(user, Some("user"))
    assertEquals(pass, Some("secret"))
  }

  test("toJdbcUrl: passes through jdbc:postgresql:// URLs unchanged") {
    val raw = "jdbc:postgresql://localhost:5432/mydb"
    val (url, user, pass) = parsedDatabaseUrl(raw)
    assertEquals(url, raw)
    assertEquals(user, None)
    assertEquals(pass, None)
  }

  test("toJdbcUrl: handles URL with query params (e.g. sslmode=require)") {
    val (url, user, pass) = parsedDatabaseUrl("postgres://u:p@host/db?sslmode=require")
    assertEquals(url, "jdbc:postgresql://host/db?sslmode=require")
    assertEquals(user, Some("u"))
    assertEquals(pass, Some("p"))
  }

  test("toJdbcUrl: handles URL without credentials") {
    val (url, user, pass) = parsedDatabaseUrl("postgres://localhost:5432/summit")
    assertEquals(url, "jdbc:postgresql://localhost:5432/summit")
    assertEquals(user, None)
    assertEquals(pass, None)
  }

  test("toJdbcUrl: rejects non-Postgres URLs instead of converting them") {
    val rawUrl = AppConfig.toJdbcUrl("mysql://user:secret@db.example.com/mydb")
    val jdbcUrl = AppConfig.toJdbcUrl("jdbc:mysql://db.example.com/mydb")

    assert(rawUrl.left.exists(_.getMessage.contains("DATABASE_URL must use")))
    assert(jdbcUrl.left.exists(_.getMessage.contains("DATABASE_URL must use")))
  }

  test("loadFromEnv rejects unsupported production DATABASE_URL schemes") {
    load(prodEnv + ("DATABASE_URL" -> "mysql://user:secret@db.example.com/mydb"))
      .map(result => assert(result.left.exists(_.getMessage.contains("DATABASE_URL must use"))))
  }

  test("toJdbcUrl rejects malformed DATABASE_URL without echoing credentials") {
    val result = AppConfig.toJdbcUrl("postgres://user:secret with spaces@db.example.com/mydb")
    assert(result.left.exists(_.getMessage == "DATABASE_URL must be a valid Postgres URL."))
    assert(!result.left.exists(_.getMessage.contains("secret")))
  }

  test("ensureProdSslMode: appends sslmode=require in prod when missing") {
    val result = AppConfig.ensureProdSslMode("jdbc:postgresql://db.example.com/mydb", AppEnv.Prod)
    assertEquals(result, Right("jdbc:postgresql://db.example.com/mydb?sslmode=require"))
  }

  test("ensureProdSslMode: preserves existing strict sslmode in prod") {
    val result = AppConfig.ensureProdSslMode(
      "jdbc:postgresql://db.example.com/mydb?connectTimeout=10&sslmode=verify-full",
      AppEnv.Prod,
    )
    assertEquals(
      result,
      Right("jdbc:postgresql://db.example.com/mydb?connectTimeout=10&sslmode=verify-full"),
    )
  }

  test("ensureProdSslMode: rejects weak sslmode in prod") {
    val result = AppConfig
      .ensureProdSslMode("jdbc:postgresql://db.example.com/mydb?sslmode=disable", AppEnv.Prod)
    assert(result.isLeft, s"expected weak sslmode to be rejected: $result")
  }

  test("ensureProdSslMode: leaves non-prod URLs unchanged") {
    val result = AppConfig.ensureProdSslMode("jdbc:postgresql://localhost:5432/mydb", AppEnv.Test)
    assertEquals(result, Right("jdbc:postgresql://localhost:5432/mydb"))
  }

  test("numeric env parsing rejects malformed values instead of silently using defaults") {
    assert(
      AppConfig.parsePositiveLong(Map("REQUEST_MAX_BYTES" -> "nope"), "REQUEST_MAX_BYTES", 1L)
        .isLeft
    )
    assert(AppConfig.parsePositiveInt(Map("DB_POOL_SIZE" -> "0"), "DB_POOL_SIZE", 2).isLeft)
    assert(AppConfig.parsePort(Map("HTTP_PORT" -> "0"), "HTTP_PORT", 8080).isLeft)
    assert(AppConfig.parsePort(Map("HTTP_PORT" -> "70000"), "HTTP_PORT", 8080).isLeft)
    assertEquals(
      AppConfig.parseNonNegativeInt(
        Map("EXPORT_RATE_LIMIT_PER_MINUTE" -> "0"),
        "EXPORT_RATE_LIMIT_PER_MINUTE",
        30,
      ),
      Right(0),
    )
  }

  test("loadFromEnv rejects malformed HTTP_PORT instead of silently using the default") {
    load(Map("HTTP_PORT" -> "not-a-port"))
      .map(result => assert(result.isLeft, s"expected malformed HTTP_PORT to fail: $result"))
  }

  test("loadFromEnv keeps production auth cookies secure by configuration") {
    load(prodEnv).map { result =>
      assertEquals(result.map(_.auth.useSecureCookies), Right(true))
      assertEquals(result.map(_.auth.sessionCookieName), Right("__Host-momo_result_session"))
      assertEquals(result.map(_.auth.stateCookieName), Right("__Host-momo_result_oauth_state"))
    }
  }

  test("loadFromEnv reads low-frequency OCR maintenance intervals") {
    load(
      prodEnv ++ Map(
        "OCR_OUTBOX_RECOVERY_INTERVAL_SECONDS" -> "1200",
        "STALE_OCR_JOB_REAPER_INTERVAL_SECONDS" -> "1800",
      )
    ).map { result =>
      assertEquals(result.map(_.resourceLimits.ocrOutboxRecoveryInterval.toSeconds), Right(1200L))
      assertEquals(result.map(_.resourceLimits.staleOcrJobReaperInterval.toSeconds), Right(1800L))
    }
  }

  test("loadFromEnv rejects insecure production auth cookies") {
    load(prodEnv + ("AUTH_COOKIE_SECURE" -> "false")).map { result =>
      assert(result.left.exists(_.getMessage.contains("AUTH_COOKIE_SECURE must be true")))
    }
  }

  test("loadFromEnv rejects production __Host cookie prefix drift") {
    load(prodEnv + ("SESSION_COOKIE_NAME" -> "momo_result_session")).map { result =>
      assert(result.left.exists(_.getMessage.contains("AUTH_COOKIE_HOST_PREFIX requires __Host-")))
    }
  }

  test("loadFromEnv rejects external OAuth callback redirect paths") {
    (
      load(prodEnv + ("AUTH_CALLBACK_REDIRECT_PATH" -> "https://evil.example/")),
      load(prodEnv + ("AUTH_CALLBACK_REDIRECT_PATH" -> "//evil.example/")),
    ).mapN { (absolute, schemeRelative) =>
      assert(
        absolute.left.exists(_.getMessage.contains("AUTH_CALLBACK_REDIRECT_PATH")),
        s"expected absolute redirect path to fail: $absolute",
      )
      assert(
        schemeRelative.left.exists(_.getMessage.contains("AUTH_CALLBACK_REDIRECT_PATH")),
        s"expected scheme-relative redirect path to fail: $schemeRelative",
      )
    }
  }
