package momo.api.endpoints

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class ApiEndpointsArchitectureSpec extends FunSuite:
  private val endpointDir = Paths.get("src/main/scala/momo/api/endpoints")
  private val httpDir = Paths.get("src/main/scala/momo/api/http")
  private val httpModulesDir = httpDir.resolve("modules")
  private val codecDir = Paths.get("src/main/scala/momo/api/codec")
  private val ocrWorkerJobMessage = Paths
    .get("src/main/scala/momo/api/contracts/ocrworker/OcrWorkerJobMessageV2.scala")
  private val authModule = Paths.get("src/main/scala/momo/api/http/modules/AuthModule.scala")
  private val authPolicy = httpDir.resolve("AuthPolicy.scala")
  private val commonEndpoint = endpointDir.resolve("CommonEndpoint.scala")
  private val maxBodySizeMiddleware = httpDir.resolve("MaxBodySizeMiddleware.scala")
  private val healthModule = httpModulesDir.resolve("HealthModule.scala")
  private val requestIdMiddleware = httpDir.resolve("RequestIdMiddleware.scala")
  private val httpOperation = Paths.get("src/main/scala/momo/api/http/HttpOperation.scala")

  private val ObjectBlock =
    raw"(?s)object\s+([A-Za-z0-9_]+Endpoints):(.+?)(?=\nobject\s+[A-Za-z0-9_]+Endpoints:|\z)".r
  private val EndpointVal =
    raw"val\s+([A-Za-z0-9_]+)\s*:\s*(?:PublicEndpoint|SecuredRead|Endpoint|CommonEndpoint\.Secured(?:Read|Mutation))".r
  private val ServerLogicRef =
    raw"([A-Za-z0-9_]+Endpoints\.[A-Za-z0-9_]+)\s*\.(?:serverLogic(?:Success)?|serverSecurityLogic)".r
  private val SecuredLogicRef =
    raw"SecuredEndpoint\s*\.\s*(?:readLogic|mutationLogic|adminReadLogic|adminMutationLogic|masterMutationLogic)\([^,]+,\s*([A-Za-z0-9_]+Endpoints\.[A-Za-z0-9_]+)\)".r
  private val OperationLabelLiteral = """"(?:GET|POST|PUT|PATCH|DELETE) /api[^"]*"""".r

  test("ApiEndpoints.all includes every Tapir endpoint definition"):
    val apiEndpointsText = read(endpointDir.resolve("ApiEndpoints.scala"))
    val missing = definedEndpointRefs.filterNot(apiEndpointsText.contains).sorted

    assertEquals(missing, Nil)

  test("every non-auth Tapir endpoint has server logic"):
    val serverRefs = scalaFiles(httpDir).map(path => read(path))
      .flatMap(text =>
        ServerLogicRef.findAllMatchIn(text).map(_.group(1)) ++
          SecuredLogicRef.findAllMatchIn(text).map(_.group(1))
      ).toSet
    val missing = definedEndpointRefs.filterNot(serverRefs.contains).sorted

    assertEquals(missing, Nil)

  test("API boundaries parse ids before constructing domain id types"):
    val boundaryFiles = scalaFiles(endpointDir) ++ scalaFiles(httpDir) ++ scalaFiles(codecDir) ++
      List(ocrWorkerJobMessage)
    val violations = boundaryFiles.flatMap { path =>
      if read(path).contains("unsafeFromString") then Some(path.toString) else None
    }.sorted

    assertEquals(violations, Nil)

  test("Tapir auth routes share the same path contract as Tapir auth endpoints"):
    val text = read(authModule)
    val endpointText = read(endpointDir.resolve("AuthEndpoints.scala"))

    assert(text.contains("AuthEndpoints.login.serverLogic"))
    assert(text.contains("AuthEndpoints.callback.serverLogic"))
    assert(text.contains("AuthEndpoints.logout"))
    assert(text.contains("AuthEndpoints.me"))
    assert(endpointText.contains("AuthPaths.Api / AuthPaths.Auth / AuthPaths.Login"))
    assert(endpointText.contains("AuthPaths.Api / AuthPaths.Auth / AuthPaths.Callback"))
    assert(endpointText.contains("AuthPaths.Api / AuthPaths.Auth / AuthPaths.Logout"))
    assert(endpointText.contains("AuthPaths.Api / AuthPaths.Auth / AuthPaths.Me"))
    assert(endpointText.contains("AuthPaths.SilentQuery"))
    assert(endpointText.contains("AuthPaths.NextQuery"))
    assert(endpointText.contains("AuthPaths.CodeQuery"))
    assert(endpointText.contains("AuthPaths.StateQuery"))
    assert(endpointText.contains("AuthPaths.ErrorQuery"))
    assert(text.contains("AuthPaths.LoginPath"))
    assert(!text.contains("\"/api/auth/login\""))
    assert(!text.contains("\"/api/auth/callback\""))
    assert(!text.contains("\"/api/auth/logout\""))
    assert(!text.contains("\"/api/auth/me\""))
    assert(!Files.exists(httpDir.resolve("AuthHttpRoutes.scala")))

  test("Tapir endpoints and middleware share common HTTP header names"):
    val endpointText = read(commonEndpoint)
    val requestIdText = read(requestIdMiddleware)

    assert(endpointText.contains("AuthHeaderNames.AccountId"))
    assert(endpointText.contains("AuthHeaderNames.CsrfToken"))
    assert(endpointText.contains("AuthHeaderNames.RequestId"))
    assert(endpointText.contains("AuthHeaderNames.IdempotencyKey"))
    assert(requestIdText.contains("AuthHeaderNames.RequestId"))
    assert(!endpointText.contains("""header[Option[String]]("X-CSRF-Token")"""))
    assert(!endpointText.contains("""header[Option[String]]("X-Request-Id")"""))
    assert(!endpointText.contains("""header[Option[String]]("Idempotency-Key")"""))
    assert(!requestIdText.contains("""CIString("X-Request-Id")"""))

  test("Tapir endpoints and middleware share common public path contracts"):
    val healthEndpointText = read(endpointDir.resolve("HealthEndpoints.scala"))
    val uploadEndpointText = read(endpointDir.resolve("UploadEndpoints.scala"))
    val maxBodyText = read(maxBodySizeMiddleware)
    val healthModuleText = read(healthModule)

    assert(healthEndpointText.contains("HealthPaths.Health"))
    assert(healthEndpointText.contains("HealthPaths.Details"))
    assert(uploadEndpointText.contains("UploadPaths.Api"))
    assert(uploadEndpointText.contains("UploadPaths.Uploads"))
    assert(uploadEndpointText.contains("UploadPaths.Images"))
    assert(healthModuleText.contains("HealthPaths.Health"))
    assert(healthModuleText.contains("HealthPaths.Details"))
    assert(maxBodyText.contains("UploadPaths.ImageUploadPath"))
    assert(!healthEndpointText.contains(""".in("healthz")"""))
    assert(!healthEndpointText.contains(""""healthz" / "details""""))
    assert(!uploadEndpointText.contains(""".in("api" / "uploads" / "images")"""))
    assert(!healthModuleText.contains("\"/healthz\""))
    assert(!maxBodyText.contains("\"/api/uploads/images\""))

  test("production auth resolves sessions from server requests instead of middleware-injected ids"):
    val text = read(authPolicy)

    assert(text.contains("case AppEnv.Prod => new ProductionAuthPolicy"))
    assert(text.contains("sessionCookie(config, context.request)"))
    assert(!text.contains("ProductionSessionMiddleware"))

  test("HTTP modules use shared operation labels for cross-cutting scopes"):
    val violations = scalaFiles(httpModulesDir).flatMap { path =>
      OperationLabelLiteral.findAllMatchIn(read(path)).map(m => s"$path: ${m.matched}")
    }.sorted
    val operationText = read(httpOperation)

    assertEquals(violations, Nil)
    assert(operationText.contains("object HttpOperation"))
    assert(operationText.contains("val ConfirmMatch"))
    assert(operationText.contains("val CreateOcrJob"))
    assert(operationText.contains("val CreateGameTitle"))

  test("HTTP operation labels include item path placeholders for item mutations"):
    val operationText = read(httpOperation)
    val expected = List(
      """val UpdateLoginAccount = "PATCH /api/admin/login-accounts/:id"""",
      """val CancelOcrJob = "DELETE /api/ocr-jobs/:id"""",
      """val DeleteHeldEvent = "DELETE /api/held-events/:id"""",
      """val UpdateGameTitle = "PATCH /api/game-titles/:id"""",
      """val DeleteGameTitle = "DELETE /api/game-titles/:id"""",
      """val UpdateMapMaster = "PATCH /api/map-masters/:id"""",
      """val DeleteMapMaster = "DELETE /api/map-masters/:id"""",
      """val UpdateSeasonMaster = "PATCH /api/season-masters/:id"""",
      """val DeleteSeasonMaster = "DELETE /api/season-masters/:id"""",
      """val UpdateMemberAlias = "PATCH /api/member-aliases/:id"""",
      """val DeleteMemberAlias = "DELETE /api/member-aliases/:id"""",
    )
    val missing = expected.filterNot(operationText.contains).sorted

    assertEquals(missing, Nil)

  private def definedEndpointRefs: List[String] = scalaFiles(endpointDir).flatMap { path =>
    ObjectBlock.findAllMatchIn(read(path)).flatMap { objectMatch =>
      val objectName = objectMatch.group(1)
      EndpointVal.findAllMatchIn(objectMatch.group(2))
        .map(valueMatch => s"$objectName.${valueMatch.group(1)}")
    }
  }.sorted

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

end ApiEndpointsArchitectureSpec
