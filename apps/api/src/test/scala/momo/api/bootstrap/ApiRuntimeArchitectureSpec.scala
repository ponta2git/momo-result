package momo.api.bootstrap

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import munit.FunSuite

final class ApiRuntimeArchitectureSpec extends FunSuite:
  private val apiAppFile = Paths.get("src/main/scala/momo/api/bootstrap/ApiApp.scala")
  private val databaseFile = Paths.get("src/main/scala/momo/api/db/Database.scala")

  test("database connection acquisition does not run on the Cats Effect compute pool"):
    val apiAppText = read(apiAppFile)
    val databaseText = read(databaseFile)

    assert(!apiAppText.contains("Async[F].executionContext"))
    assert(apiAppText.contains("Database.transactor[F](db)"))
    assert(databaseText.contains("ExecutionContexts.fixedThreadPool[F](config.poolSize)"))
    assert(databaseText.contains("connectEC = connectExecutionContext"))

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)
end ApiRuntimeArchitectureSpec
