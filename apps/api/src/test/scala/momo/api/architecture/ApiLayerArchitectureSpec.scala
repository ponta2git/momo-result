package momo.api.architecture

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class ApiLayerArchitectureSpec extends FunSuite:
  private val mainRoot = Paths.get("src/main/scala/momo/api")
  private val adaptersRoot = mainRoot.resolve("adapters")
  private val domainRoot = mainRoot.resolve("domain")
  private val repositoriesRoot = mainRoot.resolve("repositories")
  private val usecasesRoot = mainRoot.resolve("usecases")

  test("domain layer imports no outer layers"):
    val violations = forbiddenImportViolations(
      root = domainRoot,
      forbiddenPrefixes = List(
        "momo.api.adapters",
        "momo.api.bootstrap",
        "momo.api.endpoints",
        "momo.api.errors",
        "momo.api.http",
        "momo.api.ports",
        "momo.api.repositories",
        "momo.api.usecases",
      ),
    )

    assertEquals(violations, Nil)

  test("repository ports stay independent from adapters and use cases"):
    val violations = forbiddenImportViolations(
      root = repositoriesRoot,
      forbiddenPrefixes = List(
        "momo.api.adapters",
        "momo.api.bootstrap",
        "momo.api.endpoints",
        "momo.api.http",
        "momo.api.usecases",
      ),
    )

    assertEquals(violations, Nil)

  test("use cases do not import adapters or HTTP endpoint layers"):
    val violations = forbiddenImportViolations(
      root = usecasesRoot,
      forbiddenPrefixes = List(
        "momo.api.adapters",
        "momo.api.bootstrap",
        "momo.api.endpoints",
        "momo.api.http",
      ),
    )

    assertEquals(violations, Nil)

  test("adapters do not import use cases or HTTP endpoint layers"):
    val violations = forbiddenImportViolations(
      root = adaptersRoot,
      forbiddenPrefixes = List(
        "momo.api.bootstrap",
        "momo.api.endpoints",
        "momo.api.http",
        "momo.api.usecases",
      ),
    )

    assertEquals(violations, Nil)

  private def forbiddenImportViolations(
      root: Path,
      forbiddenPrefixes: List[String],
  ): List[String] = scalaFiles(root).flatMap { path =>
    importLines(path).flatMap { line =>
      forbiddenPrefixes.find(prefix => line.contains(prefix)).map(prefix => s"$path: $prefix")
    }
  }.sorted

  private def importLines(path: Path): Iterator[String] =
    read(path).linesIterator.map(_.trim).filter(_.startsWith("import "))

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

end ApiLayerArchitectureSpec
