package momo.api.bootstrap

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import munit.FunSuite

final class ApiRuntimeArchitectureSpec extends FunSuite:
  private val mainFile = Paths.get("src/main/scala/momo/api/Main.scala")
  private val apiAppFile = Paths.get("src/main/scala/momo/api/bootstrap/ApiApp.scala")
  private val postgresApiRuntimeFile =
    Paths.get("src/main/scala/momo/api/bootstrap/PostgresApiRuntime.scala")
  private val inMemoryApiRuntimeFile =
    Paths.get("src/main/scala/momo/api/bootstrap/InMemoryApiRuntime.scala")
  private val runtimeInfrastructureFile =
    Paths.get("src/main/scala/momo/api/bootstrap/RuntimeInfrastructure.scala")
  private val useCaseWiringFile = Paths.get("src/main/scala/momo/api/bootstrap/UseCaseWiring.scala")
  private val databaseFile = Paths.get("src/main/scala/momo/api/db/Database.scala")
  private val authModuleFile =
    Paths.get("src/main/scala/momo/api/http/modules/AuthModule.scala")
  private val completeOAuthLoginFile =
    Paths.get("src/main/scala/momo/api/auth/CompleteOAuthLogin.scala")
  private val ocrJobCreationStoreFile =
    Paths.get("src/main/scala/momo/api/repositories/OcrJobCreationStore.scala")
  private val createOcrJobFile =
    Paths.get("src/main/scala/momo/api/usecases/ocr/CreateOcrJob.scala")
  private val ocrOutboxDispatcherFile = Paths.get(
    "src/main/scala/momo/api/usecases/ocr/OcrQueueOutboxDispatcher.scala"
  )
  private val analysisOutboxDispatcherFile = Paths.get(
    "src/main/scala/momo/api/usecases/seriesanalysis/SeriesAnalysisQueueOutboxDispatcher.scala"
  )
  private val outboxWakeCoordinatorFile =
    Paths.get("src/main/scala/momo/api/usecases/queue/OutboxWakeCoordinator.scala")
  private val ocrQueueSubmitterFile =
    Paths.get("src/main/scala/momo/api/usecases/ocr/OcrJobQueueSubmitter.scala")
  private val imageUploadDomainFile = Paths.get("src/main/scala/momo/api/domain/ImageUpload.scala")
  private val ocrJobDomainFile = Paths.get("src/main/scala/momo/api/domain/OcrJob.scala")
  private val localFsImageStoreFile =
    Paths.get("src/main/scala/momo/api/adapters/storage/local/LocalFsImageStore.scala")
  private val localSourceImageObjectStorageFile = Paths.get(
    "src/main/scala/momo/api/adapters/storage/local/LocalSourceImageObjectStorage.scala"
  )
  private val imageValidationFile =
    Paths.get("src/main/scala/momo/api/adapters/storage/ImageValidation.scala")
  private val imageFormatParsersFile =
    Paths.get("src/main/scala/momo/api/adapters/storage/ImageFormatParsers.scala")
  private val generatedIdUsecaseFiles = List(
    Paths.get("src/main/scala/momo/api/usecases/admin/AdminLoginAccounts.scala"),
    Paths.get("src/main/scala/momo/api/usecases/heldevents/CreateHeldEvent.scala"),
    Paths.get("src/main/scala/momo/api/usecases/masters/ManageMasters.scala"),
    Paths.get("src/main/scala/momo/api/usecases/matches/ConfirmMatch.scala"),
    Paths.get("src/main/scala/momo/api/usecases/matchdrafts/CreateMatchDraft.scala"),
    Paths.get("src/main/scala/momo/api/usecases/ocr/CreateOcrJob.scala"),
  )

  test("database connection acquisition does not run on the Cats Effect compute pool"):
    val apiAppText = read(apiAppFile)
    val postgresRuntimeText = read(postgresApiRuntimeFile)
    val databaseText = read(databaseFile)

    assert(!apiAppText.contains("Async[F].executionContext"))
    assert(postgresRuntimeText.contains("Database.transactor[F](db)"))
    assert(databaseText.contains("ExecutionContexts.fixedThreadPool[F](config.poolSize)"))
    assert(databaseText.contains("connectEC = connectExecutionContext"))

  test("API runtime shares one Redis client across queue and rate limiters"):
    val runtimeInfrastructureText = read(runtimeInfrastructureFile)

    assert(
      runtimeInfrastructureText.contains("Redis[F].simple(redis.url, RedisCodec.Utf8).evalMap")
    )
    assert(
      runtimeInfrastructureText.contains(
        "RedisOcrJobQueuePublisher.fromCommands(redis.v2Stream, commands)"
      )
    )
    assert(runtimeInfrastructureText.contains("healthProbeFromCommands(redis.v2DeadLetterStream"))
    assert(runtimeInfrastructureText.contains(
      "RedisSeriesAnalysisQueuePublisher.fromCommands(redis.analysisStream, commands)"
    ))
    assert(runtimeInfrastructureText.contains(".fromCommands(commands, \"login\""))
    assert(runtimeInfrastructureText.contains("\"auth-callback-state\""))
    assert(runtimeInfrastructureText.contains("RedisOAuthProviderBackoff.fromCommands"))
    assert(runtimeInfrastructureText.contains("\"ocr-job-create\""))
    assert(runtimeInfrastructureText.contains("\"ocr-job-create-global\""))
    assert(runtimeInfrastructureText.contains("readApi <- ResilientRateLimiter.create[F]"))
    assert(runtimeInfrastructureText.contains("mutation <- ResilientRateLimiter.create[F]"))
    assert(!runtimeInfrastructureText.contains("ocrJobCreate <- ResilientRateLimiter"))
    assert(!runtimeInfrastructureText.contains("SeriesAnalysisQueuePublisher.noop"))

  test("Postgres writes share one event-driven outbox wake boundary"):
    val mainText = read(mainFile)
    val postgresRuntimeText = read(postgresApiRuntimeFile)
    val inMemoryRuntimeText = read(inMemoryApiRuntimeFile)
    val ocrDispatcherText = read(ocrOutboxDispatcherFile)
    val analysisDispatcherText = read(analysisOutboxDispatcherFile)
    val outboxCoordinatorText = read(outboxWakeCoordinatorFile)
    val ocrQueueSubmitterText = read(ocrQueueSubmitterFile)

    assertEquals(count(postgresRuntimeText, "OutboxWakeup.resource[F]"), 1)
    assert(postgresRuntimeText.contains("OutboxWakingRepositories.ocrJobCreation("))
    assert(postgresRuntimeText.contains("OutboxWakingRepositories.matches("))
    assert(postgresRuntimeText.contains("OutboxWakingRepositories.matchConfirmation("))
    assert(postgresRuntimeText.contains("OutboxWakingRepositories.seriesAnalysis("))
    assert(postgresRuntimeText.contains("OcrJobQueueSubmitter.durable[F]"))
    assert(postgresRuntimeText.contains("reportCoordinatorFailure"))
    assert(postgresRuntimeText.contains("backgroundFailure = backgroundFailure.get"))
    assert(!postgresRuntimeText.contains("pollInterval"))
    assert(mainText.contains("tupleLeft(runtime.backgroundFailure)"))
    assert(mainText.contains("awaitRuntimeFailure(backgroundFailure)"))
    assertEquals(count(ocrDispatcherText, "def resource"), 1)
    assertEquals(count(analysisDispatcherText, "def resource"), 1)
    assertEquals(count(outboxCoordinatorText, "def resource"), 1)
    assert(!ocrDispatcherText.contains("OutboxWakeup.resource"))
    assert(!analysisDispatcherText.contains("OutboxWakeup.resource"))
    assert(ocrQueueSubmitterText.contains("private[api] def nonDurable"))
    assert(inMemoryRuntimeText.contains("OcrJobQueueSubmitter.nonDurable"))
    assert(!postgresRuntimeText.contains("OcrJobQueueSubmitter.nonDurable"))

  test("API runtime validates dev identities before constructing domain ids"):
    val apiAppText = read(apiAppFile)
    val inMemoryRuntimeText = read(inMemoryApiRuntimeFile)
    val useCaseWiringText = read(useCaseWiringFile)

    assert(inMemoryRuntimeText.contains("MemberRoster.devIdentities(config.devMemberIds)"))
    assert(useCaseWiringText.contains("MemberRoster.devFromMemberIds(config.devMemberIds)"))
    assert(!apiAppText.contains("unsafeFromString"))
    assert(!inMemoryRuntimeText.contains("unsafeFromString"))
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
    assert(useCaseWiringText.contains("imageStorageAdmission: ImageStorageAdmission[F]"))
    assert(localFsText.contains(
      "extends ImageStorage[F], ImageStorageInspector[F], ReferenceAwareImageOrphanCleaner[F]"
    ))

  test("Postgres local image storage preserves the database-backed object lifecycle"):
    val postgresRuntimeText = read(postgresApiRuntimeFile)
    val localObjectStorageText = read(localSourceImageObjectStorageFile)

    assert(postgresRuntimeText.contains("LocalSourceImageObjectStorage[F]"))
    assert(postgresRuntimeText.contains("objectBackedImageStorageResource("))
    assert(!postgresRuntimeText.contains("LocalFsImageStore"))
    assert(!postgresRuntimeText.contains("PostgresImageReferenceRepository"))
    assert(localObjectStorageText.contains("extends SourceImageObjectStorage[F]"))

  test("image header parsing remains split by image format"):
    val validationText = read(imageValidationFile)
    val parserText = read(imageFormatParsersFile)

    assert(validationText.contains("ImageFormatParsers.detect(bytes)"))
    assert(validationText.contains("ImageFormatParsers.dimensions(bytes, imageType)"))
    assert(parserText.contains("private object PngParser"))
    assert(parserText.contains("private object JpegParser"))
    assert(parserText.contains("private object WebpParser"))
    assert(!validationText.contains("pngHasRasterPayloadAndEnd"))
    assert(!validationText.contains("scanJpegEntropy"))
    assert(!validationText.contains("webpLosslessDimensions"))

  test("auth callback orchestration stays out of the HTTP module"):
    val authModuleText = read(authModuleFile)
    val completeOAuthLoginText = read(completeOAuthLoginFile)

    assert(authModuleText.contains("CompleteOAuthLogin[F]"))
    assert(!authModuleText.contains("findByDiscordUserId"))
    assert(!authModuleText.contains("fetchUser("))
    assert(!authModuleText.contains("sessions.create"))
    assert(completeOAuthLoginText.contains("accounts.findByDiscordUserId"))
    assert(completeOAuthLoginText.contains("sessions.create(account)"))

  test("OCR job creation store models creation plan and rejections as values"):
    val repositoryText = read(ocrJobCreationStoreFile)
    val createOcrJobText = read(createOcrJobFile)

    assert(repositoryText.contains("final case class OcrJobCreationPlan"))
    assert(repositoryText.contains("final case class OcrQueueDispatchIntent"))
    assert(repositoryText.contains("def store(plan: OcrJobCreationPlan)"))
    assert(repositoryText.contains("enum OcrJobCreationRejection"))
    assert(repositoryText.contains("type OcrJobCreationResult = Either[OcrJobCreationRejection"))
    assert(!repositoryText.contains("extends RuntimeException"))
    assert(createOcrJobText.contains("creationPlan = OcrJobCreationPlan"))
    assert(createOcrJobText.contains(".store(plan)"))
    assert(!createOcrJobText.contains(".createQueuedJob("))

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

  private def count(text: String, pattern: String): Int =
    text.sliding(pattern.length).count(_ == pattern)
end ApiRuntimeArchitectureSpec
