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
  private val redisQueuePayload = Paths
    .get("src/main/scala/momo/api/repositories/OcrQueuePayload.scala")
  private val authHttpRoutes = Paths.get("src/main/scala/momo/api/http/AuthHttpRoutes.scala")
  private val commonEndpoint = endpointDir.resolve("CommonEndpoint.scala")
  private val csrfMiddleware = httpDir.resolve("CsrfMiddleware.scala")
  private val requestIdMiddleware = httpDir.resolve("RequestIdMiddleware.scala")
  private val httpOperation = Paths.get("src/main/scala/momo/api/http/HttpOperation.scala")

  private val ObjectBlock =
    raw"(?s)object\s+([A-Za-z0-9_]+Endpoints):(.+?)(?=\nobject\s+[A-Za-z0-9_]+Endpoints:|\z)".r
  private val PublicEndpointVal = raw"val\s+([A-Za-z0-9_]+)\s*:\s*PublicEndpoint".r
  private val ServerLogicRef =
    raw"([A-Za-z0-9_]+Endpoints\.[A-Za-z0-9_]+)\s*\.serverLogic(?:Success)?".r
  private val OperationLabelLiteral = """"(?:GET|POST|PUT|PATCH|DELETE) /api[^"]*"""".r

  test("ApiEndpoints.all includes every Tapir endpoint definition"):
    val apiEndpointsText = read(endpointDir.resolve("ApiEndpoints.scala"))
    val missing = definedEndpointRefs.filterNot(apiEndpointsText.contains).sorted

    assertEquals(missing, Nil)

  test("every non-auth Tapir endpoint has server logic"):
    val serverRefs = scalaFiles(httpDir).map(path => read(path))
      .flatMap(ServerLogicRef.findAllMatchIn).map(_.group(1)).toSet
    val missing = definedEndpointRefs.filterNot(_.startsWith("AuthEndpoints."))
      .filterNot(serverRefs.contains).sorted

    assertEquals(missing, Nil)

  test("API boundaries parse ids before constructing domain id types"):
    val boundaryFiles = scalaFiles(endpointDir) ++ scalaFiles(httpDir) ++ scalaFiles(codecDir) ++
      List(redisQueuePayload)
    val violations = boundaryFiles.flatMap { path =>
      if read(path).contains("unsafeFromString") then Some(path.toString) else None
    }.sorted

    assertEquals(violations, Nil)

  test("hand-written auth routes share the same path contract as Tapir auth endpoints"):
    val text = read(authHttpRoutes)
    val endpointText = read(endpointDir.resolve("AuthEndpoints.scala"))

    assert(text.contains("AuthPaths.LoginPath"))
    assert(text.contains("AuthPaths.CallbackPath"))
    assert(text.contains("AuthPaths.LogoutPath"))
    assert(text.contains("AuthPaths.MePath"))
    assert(endpointText.contains("AuthPaths.SilentQuery"))
    assert(endpointText.contains("AuthPaths.NextQuery"))
    assert(endpointText.contains("AuthPaths.CodeQuery"))
    assert(endpointText.contains("AuthPaths.StateQuery"))
    assert(endpointText.contains("AuthPaths.ErrorQuery"))
    assert(text.contains("AuthPaths.SilentQuery"))
    assert(text.contains("AuthPaths.NextQuery"))
    assert(text.contains("AuthPaths.CodeQuery"))
    assert(text.contains("AuthPaths.StateQuery"))
    assert(text.contains("AuthPaths.ErrorQuery"))
    assert(!text.contains("\"/api/auth/login\""))
    assert(!text.contains("\"/api/auth/callback\""))
    assert(!text.contains("\"/api/auth/logout\""))
    assert(!text.contains("\"/api/auth/me\""))
    assert(!text.contains("params.get(\"silent\")"))
    assert(!text.contains("params.get(\"next\")"))
    assert(!text.contains("params.get(\"code\")"))
    assert(!text.contains("params.get(\"state\")"))
    assert(!text.contains("params.get(\"error\")"))

  test("Tapir endpoints and middleware share common HTTP header names"):
    val endpointText = read(commonEndpoint)
    val csrfText = read(csrfMiddleware)
    val requestIdText = read(requestIdMiddleware)

    assert(endpointText.contains("AuthHeaderNames.AccountId"))
    assert(endpointText.contains("AuthHeaderNames.CsrfToken"))
    assert(endpointText.contains("AuthHeaderNames.RequestId"))
    assert(endpointText.contains("AuthHeaderNames.IdempotencyKey"))
    assert(csrfText.contains("AuthHeaderNames.CsrfToken"))
    assert(requestIdText.contains("AuthHeaderNames.RequestId"))
    assert(!endpointText.contains("""header[Option[String]]("X-CSRF-Token")"""))
    assert(!endpointText.contains("""header[Option[String]]("X-Request-Id")"""))
    assert(!endpointText.contains("""header[Option[String]]("Idempotency-Key")"""))
    assert(!csrfText.contains("""val HeaderName = "X-CSRF-Token""""))
    assert(!requestIdText.contains("""CIString("X-Request-Id")"""))

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

  private def definedEndpointRefs: List[String] = scalaFiles(endpointDir).flatMap { path =>
    ObjectBlock.findAllMatchIn(read(path)).flatMap { objectMatch =>
      val objectName = objectMatch.group(1)
      PublicEndpointVal.findAllMatchIn(objectMatch.group(2))
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
