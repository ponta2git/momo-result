package momo.api.integration.redis

import scala.concurrent.duration.DurationInt

import cats.effect.{IO, Resource}
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName

import momo.api.MomoCatsEffectSuite
import momo.api.testing.TestTags

abstract class RedisIntegrationSuite extends MomoCatsEffectSuite:
  override def munitIOTimeout = 60.seconds

  override def munitTests(): Seq[munit.Test] = super.munitTests()
    .map(_.tag(TestTags.RedisIntegration))

  protected def redisUrlResource: Resource[IO, String] = Resource
    .eval(RedisIntegrationSuite.redisUrl)

end RedisIntegrationSuite

private object RedisIntegrationSuite:
  def redisUrl: IO[String] = IO.blocking {
    val container = sharedContainer
    s"redis://${container.getHost}:${container.getMappedPort(6379)}"
  }

  /** One isolated service per forked gate; every test owns a unique key or stream namespace. */
  private lazy val sharedContainer: GenericContainer[?] =
    val container = new GenericContainer(DockerImageName.parse("redis:7-alpine"))
    container.addExposedPort(6379)
    container.start()
    val _ = sys.addShutdownHook(container.stop())
    container

end RedisIntegrationSuite
