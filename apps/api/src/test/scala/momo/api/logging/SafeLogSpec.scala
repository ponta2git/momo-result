package momo.api.logging

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}

import scala.jdk.CollectionConverters.*

import munit.FunSuite

final class SafeLogSpec extends FunSuite:
  private val sourceRoot = Paths.get("src/main/scala/momo/api")
  private val Log4catsThrowableError =
    raw"\.error\s*\(\s*[A-Za-z0-9_]*error[A-Za-z0-9_]*\s*\)\s*\(".r
  private val Slf4jThrowableError =
    raw"(?s)logger\.error\s*\([^)]*,\s*[A-Za-z0-9_]*error[A-Za-z0-9_]*\s*,?\s*\)".r

  test("throwableClasses records class chain without exception messages"):
    val cause = new IllegalArgumentException("postgres://user:secret@db.example.com/momo")
    val error = new IllegalStateException("secret_table", cause)

    val rendered = SafeLog.throwableClasses(error)

    assertEquals(
      rendered,
      "java.lang.IllegalStateException>java.lang.IllegalArgumentException",
    )
    assert(!rendered.contains("secret"))
    assert(!rendered.contains("secret_table"))

  test("application logs do not pass Throwable values directly to error loggers"):
    val violations = scalaFiles(sourceRoot).flatMap { path =>
      val text = read(path)
      val matches = Log4catsThrowableError.findAllMatchIn(text).map(_.matched).toList ++
        Slf4jThrowableError.findAllMatchIn(text).map(_.matched).toList
      matches.map(matched => s"$path: $matched")
    }

    assertEquals(violations.sorted, Nil)

  private def scalaFiles(root: Path): List[Path] =
    val stream = Files.walk(root)
    try stream.iterator.asScala
        .filter(path => Files.isRegularFile(path) && path.toString.endsWith(".scala")).toList
    finally stream.close()

  private def read(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)

end SafeLogSpec
