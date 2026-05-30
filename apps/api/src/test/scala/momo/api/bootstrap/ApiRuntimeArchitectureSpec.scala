package momo.api.bootstrap

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import munit.FunSuite

final class ApiRuntimeArchitectureSpec extends FunSuite:
  private val apiAppFile = Paths.get("src/main/scala/momo/api/bootstrap/ApiApp.scala")
  private val databaseFile = Paths.get("src/main/scala/momo/api/db/Database.scala")
  private val generatedIdUsecaseFiles = List(
    Paths.get("src/main/scala/momo/api/usecases/AdminLoginAccounts.scala"),
    Paths.get("src/main/scala/momo/api/usecases/ConfirmMatch.scala"),
    Paths.get("src/main/scala/momo/api/usecases/CreateHeldEvent.scala"),
    Paths.get("src/main/scala/momo/api/usecases/CreateMatchDraft.scala"),
    Paths.get("src/main/scala/momo/api/usecases/CreateOcrJob.scala"),
    Paths.get("src/main/scala/momo/api/usecases/ManageMasters.scala"),
  )

  test("database connection acquisition does not run on the Cats Effect compute pool"):
    val apiAppText = read(apiAppFile)
    val databaseText = read(databaseFile)

    assert(!apiAppText.contains("Async[F].executionContext"))
    assert(apiAppText.contains("Database.transactor[F](db)"))
    assert(databaseText.contains("ExecutionContexts.fixedThreadPool[F](config.poolSize)"))
    assert(databaseText.contains("connectEC = connectExecutionContext"))

  test("API runtime shares one Redis client across queue and rate limiters"):
    val apiAppText = read(apiAppFile)

    assert(apiAppText.contains("Redis[F].simple(redis.url, RedisCodec.Utf8).map"))
    assert(apiAppText.contains("RedisQueueProducer.fromCommands(redis.stream, commands)"))
    assert(apiAppText.contains("healthProbeFromCommands(redis.deadLetterStream"))
    assert(apiAppText.contains(".fromCommands(commands, \"login\""))
    assert(apiAppText.contains("\"auth-callback-state\""))
    assert(apiAppText.contains("RedisOAuthProviderBackoff.fromCommands"))
    assert(apiAppText.contains("\"ocr-job-create\""))
    assert(apiAppText.contains("\"ocr-job-create-global\""))
    assert(!apiAppText.contains("RedisQueueProducer.resource[F](redis)"))
    assert(!apiAppText.contains("RedisRateLimiter.resource[F](redis"))
    assert(!apiAppText.contains("RedisOAuthProviderBackoff.resource[F](redis"))

  test("API runtime validates dev identities before constructing domain ids"):
    val apiAppText = read(apiAppFile)

    assert(apiAppText.contains("MemberRoster.devIdentities(config.devMemberIds)"))
    assert(apiAppText.contains("MemberRoster.devFromMemberIds(config.devMemberIds)"))
    assert(!apiAppText.contains("unsafeFromString"))

  test("API runtime wires generated ids with their domain types"):
    val apiAppText = read(apiAppFile)
    val missingRuntimeBindings = List(
      "val nextOcrJobId = OcrJobId.fresh[F]",
      "val nextOcrDraftId = OcrDraftId.fresh[F]",
      "val nextHeldEventId = HeldEventId.fresh[F]",
      "val nextMatchDraftId = MatchDraftId.fresh[F]",
      "val nextMatchId = MatchId.fresh[F]",
      "val nextMemberAliasId = MemberAliasId.fresh[F]",
      "val nextLoginAccountId = AccountId.fresh[F]",
    ).filterNot(apiAppText.contains)
    val rawGeneratedIdViolations = generatedIdUsecaseFiles.flatMap { path =>
      val text = read(path)
      List(
        "nextId: F[String]",
        "nextJobId: F[String]",
        "nextDraftId: F[String]",
        "unsafeFromString(id)",
        "unsafeFromString(_)",
      ).filter(text.contains).map(pattern => s"$path: $pattern")
    }.sorted

    assertEquals(missingRuntimeBindings, Nil)
    assertEquals(rawGeneratedIdViolations, Nil)

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)
end ApiRuntimeArchitectureSpec
