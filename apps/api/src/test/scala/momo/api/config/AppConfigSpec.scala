package momo.api.config

import cats.effect.IO
import cats.syntax.all.*
import ciris.{ConfigValue, Effect}
import munit.CatsEffectSuite

class AppConfigSpec extends CatsEffectSuite:
  private val prodEnv: Map[String, String] = Map(
    "APP_ENV" -> "prod",
    "DATABASE_URL" -> "postgres://u:p@db.example.com/momo?sslmode=require",
    "REDIS_URL" -> "rediss://default:secret@redis.example.com:6379",
    "DISCORD_CLIENT_ID" -> "client-id",
    "DISCORD_CLIENT_SECRET" -> "client-secret",
    "DISCORD_REDIRECT_URI" -> "https://example.com/api/auth/callback",
    "AUTH_STATE_SIGNING_KEY" -> "state-signing-key",
    "SOURCE_IMAGE_STORAGE_MODE" -> "r2",
    "SOURCE_IMAGE_R2_ENDPOINT" -> "https://example.invalid",
    "SOURCE_IMAGE_R2_BUCKET" -> "momo-test",
    "SOURCE_IMAGE_R2_ACCESS_KEY_ID" -> "test-access-key",
    "SOURCE_IMAGE_R2_SECRET_ACCESS_KEY" -> "test-secret-key",
  )

  private def load(env: Map[String, String]): IO[Either[Throwable, AppConfig]] = AppConfig
    .loadFromEnv[IO](env).attempt

  private def loadConfig[A](value: ConfigValue[Effect, A]): IO[Either[Throwable, A]] =
    value.load[IO].attempt

  private def parsedDatabaseUrl(raw: String): (String, Option[String], Option[String]) =
    DatabaseUrlConfig
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
    val rawUrl = DatabaseUrlConfig.toJdbcUrl("mysql://user:secret@db.example.com/mydb")
    val jdbcUrl = DatabaseUrlConfig.toJdbcUrl("jdbc:mysql://db.example.com/mydb")

    assert(rawUrl.left.exists(_.getMessage.contains("DATABASE_URL must use")))
    assert(jdbcUrl.left.exists(_.getMessage.contains("DATABASE_URL must use")))
  }

  test("loadFromEnv rejects unsupported production DATABASE_URL schemes") {
    load(prodEnv + ("DATABASE_URL" -> "mysql://user:secret@db.example.com/mydb"))
      .map(result => assert(result.left.exists(_.getMessage.contains("DATABASE_URL must use"))))
  }

  test("toJdbcUrl rejects malformed DATABASE_URL without echoing credentials") {
    val result =
      DatabaseUrlConfig.toJdbcUrl("postgres://user:secret with spaces@db.example.com/mydb")
    assert(result.left.exists(_.getMessage == "DATABASE_URL must be a valid Postgres URL."))
    assert(!result.left.exists(_.getMessage.contains("secret")))
  }

  test("ensureProdSslMode: appends sslmode=require in prod when missing") {
    val result =
      DatabaseUrlConfig.ensureProdSslMode("jdbc:postgresql://db.example.com/mydb", AppEnv.Prod)
    assertEquals(result, Right("jdbc:postgresql://db.example.com/mydb?sslmode=require"))
  }

  test("ensureProdSslMode: preserves existing strict sslmode in prod") {
    val result = DatabaseUrlConfig.ensureProdSslMode(
      "jdbc:postgresql://db.example.com/mydb?connectTimeout=10&sslmode=verify-full",
      AppEnv.Prod,
    )
    assertEquals(
      result,
      Right("jdbc:postgresql://db.example.com/mydb?connectTimeout=10&sslmode=verify-full"),
    )
  }

  test("ensureProdSslMode: rejects weak sslmode in prod") {
    val result = DatabaseUrlConfig
      .ensureProdSslMode("jdbc:postgresql://db.example.com/mydb?sslmode=disable", AppEnv.Prod)
    assert(result.isLeft, s"expected weak sslmode to be rejected: $result")
  }

  test("ensureProdSslMode: rejects duplicate sslmode in prod") {
    val result = DatabaseUrlConfig.ensureProdSslMode(
      "jdbc:postgresql://db.example.com/mydb?sslmode=disable&sslmode=require",
      AppEnv.Prod,
    )
    assert(result.left.exists(_.getMessage.contains("specified at most once")))
  }

  test("ensureProdSslMode: leaves non-prod URLs unchanged") {
    val result =
      DatabaseUrlConfig.ensureProdSslMode("jdbc:postgresql://localhost:5432/mydb", AppEnv.Test)
    assertEquals(result, Right("jdbc:postgresql://localhost:5432/mydb"))
  }

  test("ensureProdRedisUrl: rejects insecure Redis URLs in prod") {
    val result = RedisUrlConfig.ensureProdRedisUrl(
      "redis://redis.example.com:6379",
      AppEnv.Prod,
      allowPlaintextInProd = false,
    )
    assertEquals(
      result.left.map(_.getMessage),
      Left("REDIS_URL must use rediss:// in prod APP_ENV."),
    )
  }

  test("ensureProdRedisUrl: allows plaintext Redis in prod only when explicitly enabled") {
    val url = "redis://default:secret@fly-upstash-redis.example.com:6379"
    val result = RedisUrlConfig.ensureProdRedisUrl(url, AppEnv.Prod, allowPlaintextInProd = true)
    assertEquals(result, Right(url))
  }

  test("loadFromEnv allows plaintext Redis in prod only with explicit flag") {
    val env = prodEnv ++ Map(
      "REDIS_URL" -> "redis://default:secret@fly-upstash-redis.example.com:6379",
      "REDIS_ALLOW_PLAINTEXT_IN_PROD" -> "true",
    )

    load(env).map { result =>
      assertEquals(
        result.flatMap(_.redis.map(_.url).toRight(new RuntimeException())),
        Right(env("REDIS_URL")),
      )
    }
  }

  test("loadFromEnv rejects malformed plaintext Redis override") {
    val env = prodEnv ++ Map(
      "REDIS_URL" -> "redis://default:secret@fly-upstash-redis.example.com:6379",
      "REDIS_ALLOW_PLAINTEXT_IN_PROD" -> "maybe",
    )

    load(env).map { result =>
      assert(result.left.exists(_.getMessage.contains("REDIS_ALLOW_PLAINTEXT_IN_PROD")))
    }
  }

  test("ensureProdRedisUrl: allows local Redis URLs outside prod") {
    val result = RedisUrlConfig.ensureProdRedisUrl(
      "redis://localhost:6379/0",
      AppEnv.Dev,
      allowPlaintextInProd = false,
    )
    assertEquals(result, Right("redis://localhost:6379/0"))
  }

  test("numeric env parsing rejects malformed values instead of silently using defaults") {
    for
      invalidLong <- loadConfig(
        ConfigParsers.parsePositiveLong(
          Map("REQUEST_MAX_BYTES" -> "nope"),
          "REQUEST_MAX_BYTES",
          1L,
        )
      )
      invalidPositive <- loadConfig(
        ConfigParsers.parsePositiveInt(Map("DB_POOL_SIZE" -> "0"), "DB_POOL_SIZE", 2)
      )
      zeroPort <- loadConfig(ConfigParsers.parsePort(Map("HTTP_PORT" -> "0"), "HTTP_PORT", 8080))
      highPort <- loadConfig(
        ConfigParsers.parsePort(Map("HTTP_PORT" -> "70000"), "HTTP_PORT", 8080)
      )
      invalidPercent <- loadConfig(ConfigParsers.parsePercent(
        Map("IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT" -> "101"),
        "IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT",
        90,
      ))
      nonNegative <- loadConfig(ConfigParsers.parseNonNegativeInt(
        Map("EXPORT_RATE_LIMIT_PER_MINUTE" -> "0"),
        "EXPORT_RATE_LIMIT_PER_MINUTE",
        30,
      ))
    yield
      assert(invalidLong.isLeft)
      assert(invalidPositive.isLeft)
      assert(zeroPort.isLeft)
      assert(highPort.isLeft)
      assert(invalidPercent.isLeft)
      assertEquals(nonNegative, Right(0))
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

  test("loadFromEnv requires an explicit source image storage mode in production") {
    load(prodEnv - "SOURCE_IMAGE_STORAGE_MODE").map { result =>
      assert(result.left.exists(_.getMessage.contains("SOURCE_IMAGE_STORAGE_MODE")))
    }
  }

  test("loadFromEnv defaults source image storage to local outside production") {
    load(Map.empty).map(result =>
      assertEquals(result.map(_.sourceImageStorage), Right(SourceImageStorageConfig.Local))
    )
  }

  test("loadFromEnv parses bounded R2 settings without exposing credentials") {
    val secret = "credential-that-must-not-appear"
    val env = prodEnv ++ Map(
      "SOURCE_IMAGE_R2_SECRET_ACCESS_KEY" -> secret,
      "SOURCE_IMAGE_R2_REGION" -> "auto",
      "SOURCE_IMAGE_R2_OPERATION_TIMEOUT_MS" -> "9000",
      "SOURCE_IMAGE_R2_ATTEMPT_TIMEOUT_MS" -> "4000",
      "SOURCE_IMAGE_R2_MAXIMUM_ATTEMPTS" -> "2",
      "SOURCE_IMAGE_RECONCILIATION_STALE_SECONDS" -> "90",
      "SOURCE_IMAGE_FAILED_RETENTION_MINUTES" -> "120",
      "SOURCE_IMAGE_RECONCILIATION_BATCH_SIZE" -> "200",
    )

    load(env).map { result =>
      val storage = result.fold(error => fail(error.getMessage), _.sourceImageStorage)
      storage match
        case SourceImageStorageConfig.Local => fail("expected R2 storage")
        case SourceImageStorageConfig.R2(r2) =>
          assertEquals(r2.operationTimeout.toMillis, 9000L)
          assertEquals(r2.attemptTimeout.toMillis, 4000L)
          assertEquals(r2.maximumAttempts, 2)
          assertEquals(r2.staleStateAge.toSeconds, 90L)
          assertEquals(r2.failedRecordRetention.toMinutes, 120L)
          assertEquals(r2.reconciliationBatchSize, 200)
          assert(!storage.toString.contains(secret))
    }
  }

  test("loadFromEnv rejects R2 retry and timeout settings outside the bounded envelope") {
    val invalid = List(
      Map("SOURCE_IMAGE_R2_MAXIMUM_ATTEMPTS" -> "3"),
      Map(
        "SOURCE_IMAGE_R2_OPERATION_TIMEOUT_MS" -> "1000",
        "SOURCE_IMAGE_R2_ATTEMPT_TIMEOUT_MS" -> "2000",
      ),
      Map("SOURCE_IMAGE_RECONCILIATION_BATCH_SIZE" -> "1001"),
    )

    invalid.traverse(overrides => load(prodEnv ++ overrides)).map(_.foreach(result =>
      assert(
        result.left.exists(_.getMessage == "R2 source image storage configuration is invalid."),
        s"expected unsafe R2 settings to fail: $result",
      )
    ))
  }

  test("loadFromEnv reads OAuth abuse protection limits") {
    load(
      prodEnv ++ Map(
        "AUTH_CALLBACK_STATE_RATE_LIMIT_PER_MINUTE" -> "2",
        "AUTH_PROVIDER_FAILURE_THRESHOLD" -> "4",
        "AUTH_PROVIDER_BACKOFF_SECONDS" -> "120",
      )
    ).map { result =>
      assertEquals(result.map(_.auth.callbackStateRateLimitPerMinute), Right(2))
      assertEquals(result.map(_.auth.providerFailureThreshold), Right(4))
      assertEquals(result.map(_.auth.providerBackoff.toSeconds), Right(120L))
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

  test("loadFromEnv reads the bounded series-analysis read timeout") {
    load(Map("ANALYSIS_API_READ_TIMEOUT_MS" -> "2500")).map { result =>
      assertEquals(result.map(_.seriesAnalysisRead.readTimeout.toMillis), Right(2500L))
    }
  }

  test("loadFromEnv rejects a non-positive series-analysis read timeout") {
    load(Map("ANALYSIS_API_READ_TIMEOUT_MS" -> "0")).map { result =>
      assert(result.isLeft, s"expected a non-positive read timeout to fail: $result")
    }
  }

  test("loadFromEnv rejects series-analysis limits outside the reliability envelope") {
    val invalid = List(
      Map("ANALYSIS_API_MAX_ENCODED_BYTES" -> "16777217"),
      Map("ANALYSIS_API_MAX_NESTING_DEPTH" -> "65"),
      Map("ANALYSIS_API_MAX_JSON_NODES" -> "60001"),
      Map("ANALYSIS_API_DECODE_CONCURRENCY" -> "3"),
      Map("ANALYSIS_API_READ_TIMEOUT_MS" -> "30001"),
    )
    invalid.traverse(load).map(_.foreach(result =>
      assert(
        result.left.exists(_.getMessage.contains("reliability envelope")),
        s"expected an unsafe series-analysis limit to fail: $result",
      )
    ))
  }

  test("default analysis concurrency fits the explicit 160 MiB materialization budget") {
    val config = SeriesAnalysisReadConfig.defaults
    val concurrentBytes = SeriesAnalysisReadConfigLoader.maximumMaterializationBytes(config) *
      BigInt(config.decodeConcurrency)

    assert(
      concurrentBytes <= BigInt(
        SeriesAnalysisReadConfigLoader.MaximumConcurrentMaterializationBytes
      )
    )
  }

  test("loadFromEnv reads image upload storage limits") {
    load(
      prodEnv ++ Map(
        "IMAGE_UPLOAD_UNREFERENCED_COUNT_LIMIT" -> "12",
        "IMAGE_UPLOAD_UNREFERENCED_BYTES_LIMIT" -> "33554432",
        "IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES" -> "134217728",
        "IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT" -> "85",
        "IMAGE_ORPHAN_OLDER_THAN_MINUTES" -> "15",
        "IMAGE_ORPHAN_REAPER_INTERVAL_MINUTES" -> "5",
      )
    ).map { result =>
      assertEquals(result.map(_.resourceLimits.imageUploadUnreferencedCountLimit), Right(12))
      assertEquals(result.map(_.resourceLimits.imageUploadUnreferencedBytesLimit), Right(33554432L))
      assertEquals(result.map(_.resourceLimits.imageUploadStorageMinFreeBytes), Right(134217728L))
      assertEquals(result.map(_.resourceLimits.imageUploadStorageMaxUsedPercent), Right(85))
      assertEquals(result.map(_.resourceLimits.imageOrphanOlderThan.toMinutes), Right(15L))
      assertEquals(result.map(_.resourceLimits.imageOrphanReaperInterval.toMinutes), Right(5L))
    }
  }

  test("loadFromEnv reads export, read, mutation, and source image download limits") {
    load(
      prodEnv ++ Map(
        "EXPORT_ALL_RATE_LIMIT_PER_MINUTE" -> "4",
        "EXPORT_MAX_ROWS" -> "12000",
        "EXPORT_MAX_BYTES" -> "8388608",
        "SOURCE_IMAGE_DOWNLOAD_RATE_LIMIT_PER_MINUTE" -> "90",
        "READ_API_RATE_LIMIT_PER_MINUTE" -> "150",
        "MUTATION_RATE_LIMIT_PER_MINUTE" -> "70",
        "IDEMPOTENCY_ACTIVE_KEY_LIMIT_PER_ACCOUNT" -> "300",
        "SOURCE_IMAGE_ARCHIVE_MAX_BYTES" -> "12582912",
      )
    ).map { result =>
      assertEquals(result.map(_.resourceLimits.exportAllRateLimitPerMinute), Right(4))
      assertEquals(result.map(_.resourceLimits.exportMaxRows), Right(12000))
      assertEquals(result.map(_.resourceLimits.exportMaxBytes), Right(8388608L))
      assertEquals(result.map(_.resourceLimits.sourceImageDownloadRateLimitPerMinute), Right(90))
      assertEquals(result.map(_.resourceLimits.readApiRateLimitPerMinute), Right(150))
      assertEquals(result.map(_.resourceLimits.mutationRateLimitPerMinute), Right(70))
      assertEquals(result.map(_.resourceLimits.idempotencyActiveKeyLimitPerAccount), Right(300))
      assertEquals(result.map(_.resourceLimits.sourceImageArchiveMaxBytes), Right(12582912L))
    }
  }

  test("loadFromEnv reads OCR admission limits") {
    load(
      prodEnv ++ Map(
        "OCR_JOB_CREATE_RATE_LIMIT_PER_MINUTE" -> "8",
        "OCR_JOB_CREATE_GLOBAL_RATE_LIMIT_PER_MINUTE" -> "16",
        "OCR_ACTIVE_JOB_LIMIT" -> "9",
        "OCR_OUTBOX_DUE_BACKLOG_LIMIT" -> "30",
        "OCR_OUTBOX_ACTIVE_BACKLOG_LIMIT" -> "60",
        "OCR_OUTBOX_OLDEST_DUE_MAX_DELAY_SECONDS" -> "900",
        "OCR_DEAD_LETTER_BACKLOG_LIMIT" -> "12",
      )
    ).map { result =>
      assertEquals(result.map(_.resourceLimits.ocrJobCreateRateLimitPerMinute), Right(8))
      assertEquals(result.map(_.resourceLimits.ocrJobCreateGlobalRateLimitPerMinute), Right(16))
      assertEquals(result.map(_.resourceLimits.ocrActiveJobLimit), Right(9))
      assertEquals(result.map(_.resourceLimits.ocrOutboxDueBacklogLimit), Right(30))
      assertEquals(result.map(_.resourceLimits.ocrOutboxActiveBacklogLimit), Right(60))
      assertEquals(result.map(_.resourceLimits.ocrOutboxOldestDueMaxDelay.toSeconds), Right(900L))
      assertEquals(result.map(_.resourceLimits.ocrDeadLetterBacklogLimit), Right(12))
      assertEquals(
        result.flatMap(_.redis.map(_.v2Stream).toRight(new RuntimeException())),
        Right("momo:ocr:v2:jobs"),
      )
      assertEquals(
        result.flatMap(_.redis.map(_.v2DeadLetterStream).toRight(new RuntimeException())),
        Right("momo:ocr:v2:jobs:dead"),
      )
    }
  }

  test("loadFromEnv reads dedicated OCR v2 stream names") {
    load(
      prodEnv ++ Map(
        "OCR_REDIS_V2_STREAM" -> "momo:ocr:v2:jobs:test",
        "OCR_REDIS_V2_DEAD_LETTER_STREAM" -> "momo:ocr:v2:jobs:dead:test",
      )
    ).map { result =>
      assertEquals(
        result.flatMap(_.redis.map(_.v2Stream).toRight(new RuntimeException())),
        Right("momo:ocr:v2:jobs:test"),
      )
      assertEquals(
        result.flatMap(_.redis.map(_.v2DeadLetterStream).toRight(new RuntimeException())),
        Right("momo:ocr:v2:jobs:dead:test"),
      )
    }
  }

  test("loadFromEnv ignores blank OCR Redis stream overrides") {
    load(
      prodEnv ++ Map(
        "OCR_REDIS_V2_STREAM" -> " ",
        "OCR_REDIS_V2_DEAD_LETTER_STREAM" -> "  ",
      )
    ).map { result =>
      assertEquals(
        result.flatMap(_.redis.map(_.v2Stream).toRight(new RuntimeException())),
        Right("momo:ocr:v2:jobs"),
      )
      assertEquals(
        result.flatMap(_.redis.map(_.v2DeadLetterStream).toRight(new RuntimeException())),
        Right("momo:ocr:v2:jobs:dead"),
      )
    }
  }

  test("loadFromEnv rejects insecure production auth cookies") {
    load(prodEnv + ("AUTH_COOKIE_SECURE" -> "false")).map { result =>
      assert(result.left.exists(_.getMessage.contains("AUTH_COOKIE_SECURE must be true")))
    }
  }

  test("loadFromEnv rejects production __Host cookie prefix drift") {
    load(prodEnv + ("SESSION_COOKIE_NAME" -> "momo_result_session")).map { result =>
      assert(result.left.exists(_.getMessage.contains("must use the __Host- prefix")))
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
