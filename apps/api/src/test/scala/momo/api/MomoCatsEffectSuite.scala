package momo.api

import java.nio.file.{Files, Path}

import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters.*

import cats.effect.{IO, Resource}
import munit.CatsEffectSuite

abstract class MomoCatsEffectSuite extends CatsEffectSuite:
  override def munitIOTimeout = 30.seconds

  protected def tempDirectory(prefix: String): Resource[IO, Path] = Resource
    .make(IO.blocking(Files.createTempDirectory(prefix)))(deleteRecursively)

  private def deleteRecursively(path: Path): IO[Unit] = IO.blocking {
    if Files.exists(path) then
      val stream = Files.walk(path)
      try stream.iterator().asScala.toList.reverse.foreach(Files.deleteIfExists)
      finally stream.close()
  }.void
