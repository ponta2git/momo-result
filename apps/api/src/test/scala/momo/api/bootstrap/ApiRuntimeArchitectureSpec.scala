package momo.api.bootstrap

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import munit.FunSuite

final class ApiRuntimeArchitectureSpec extends FunSuite:
  private val apiAppFile = Paths.get("src/main/scala/momo/api/bootstrap/ApiApp.scala")
  private val runtimeInfrastructureFile =
    Paths.get("src/main/scala/momo/api/bootstrap/RuntimeInfrastructure.scala")
  private val useCaseWiringFile = Paths.get("src/main/scala/momo/api/bootstrap/UseCaseWiring.scala")
  private val databaseFile = Paths.get("src/main/scala/momo/api/db/Database.scala")
  private val authModuleFile =
    Paths.get("src/main/scala/momo/api/http/modules/AuthModule.scala")
  private val completeOAuthLoginFile =
    Paths.get("src/main/scala/momo/api/auth/CompleteOAuthLogin.scala")
  private val ocrJobCreationRepositoryFile =
    Paths.get("src/main/scala/momo/api/repositories/OcrJobCreationRepository.scala")
  private val createOcrJobFile = Paths.get("src/main/scala/momo/api/usecases/CreateOcrJob.scala")
  private val imageUploadDomainFile = Paths.get("src/main/scala/momo/api/domain/ImageUpload.scala")
  private val ocrJobDomainFile = Paths.get("src/main/scala/momo/api/domain/OcrJob.scala")
  private val localFsImageStoreFile =
    Paths.get("src/main/scala/momo/api/adapters/storage/local/LocalFsImageStore.scala")
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
    val runtimeInfrastructureText = read(runtimeInfrastructureFile)

    assert(runtimeInfrastructureText.contains("Redis[F].simple(redis.url, RedisCodec.Utf8).map"))
    assert(
      runtimeInfrastructureText.contains(
        "RedisOcrJobQueuePublisher.fromCommands(redis.stream, commands)"
      )
    )
    assert(runtimeInfrastructureText.contains("healthProbeFromCommands(redis.deadLetterStream"))
    assert(runtimeInfrastructureText.contains(".fromCommands(commands, \"login\""))
    assert(runtimeInfrastructureText.contains("\"auth-callback-state\""))
    assert(runtimeInfrastructureText.contains("RedisOAuthProviderBackoff.fromCommands"))
    assert(runtimeInfrastructureText.contains("\"ocr-job-create\""))
    assert(runtimeInfrastructureText.contains("\"ocr-job-create-global\""))
    assert(!runtimeInfrastructureText.contains("RedisOcrJobQueuePublisher.resource[F](redis)"))
    assert(!runtimeInfrastructureText.contains("RedisRateLimiter.resource[F](redis"))
    assert(!runtimeInfrastructureText.contains("RedisOAuthProviderBackoff.resource[F](redis"))

  test("API runtime validates dev identities before constructing domain ids"):
    val apiAppText = read(apiAppFile)
    val useCaseWiringText = read(useCaseWiringFile)

    assert(apiAppText.contains("MemberRoster.devIdentities(config.devMemberIds)"))
    assert(useCaseWiringText.contains("MemberRoster.devFromMemberIds(config.devMemberIds)"))
    assert(!apiAppText.contains("unsafeFromString"))
    assert(!useCaseWiringText.contains("unsafeFromString"))

  test("API runtime wires generated ids with their domain types"):
    val useCaseWiringText = read(useCaseWiringFile)
    val missingRuntimeBindings = List(
      "val nextOcrJobId = OcrJobId.fresh[F]",
      "val nextOcrDraftId = OcrDraftId.fresh[F]",
      "val nextHeldEventId = HeldEventId.fresh[F]",
      "val nextMatchDraftId = MatchDraftId.fresh[F]",
      "val nextMatchId = MatchId.fresh[F]",
      "val nextMemberAliasId = MemberAliasId.fresh[F]",
      "val nextLoginAccountId = AccountId.fresh[F]",
    ).filterNot(useCaseWiringText.contains)
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

  test("image storage boundary keeps filesystem details out of domain and usecase wiring"):
    val useCaseWiringText = read(useCaseWiringFile)
    val imageUploadText = read(imageUploadDomainFile)
    val ocrJobText = read(ocrJobDomainFile)
    val localFsText = read(localFsImageStoreFile)

    assert(!imageUploadText.contains("java.nio.file.Path"))
    assert(!ocrJobText.contains("java.nio.file.Path"))
    assert(!useCaseWiringText.contains("LocalFsImageStore"))
    assert(useCaseWiringText.contains("imageStorage: ImageStorage[F]"))
    assert(useCaseWiringText.contains("imageStorageInspector: ImageStorageInspector[F]"))
    assert(localFsText.contains(
      "extends ImageStorage[F], ImageStorageInspector[F], ImageOrphanCleaner[F]"
    ))

  test("auth callback orchestration stays out of the HTTP module"):
    val authModuleText = read(authModuleFile)
    val completeOAuthLoginText = read(completeOAuthLoginFile)

    assert(authModuleText.contains("CompleteOAuthLogin[F]"))
    assert(!authModuleText.contains("findByDiscordUserId"))
    assert(!authModuleText.contains("fetchUser("))
    assert(!authModuleText.contains("sessions.create"))
    assert(completeOAuthLoginText.contains("accounts.findByDiscordUserId"))
    assert(completeOAuthLoginText.contains("sessions.create(account)"))

  test("OCR job creation repository models expected rejections as values"):
    val repositoryText = read(ocrJobCreationRepositoryFile)
    val createOcrJobText = read(createOcrJobFile)

    assert(repositoryText.contains("enum CreateQueuedJobRejection"))
    assert(repositoryText.contains("type CreateQueuedJobResult = Either[CreateQueuedJobRejection"))
    assert(!repositoryText.contains("extends RuntimeException"))
    assert(!createOcrJobText.contains(".createQueuedJob(") || !createOcrJobText.contains(
      ".attempt"
    ))

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)
end ApiRuntimeArchitectureSpec
