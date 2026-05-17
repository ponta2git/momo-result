package momo.api.integration.redis

import cats.effect.{IO, Resource}
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName

import momo.api.MomoCatsEffectSuite
import momo.api.testing.TestTags

abstract class RedisIntegrationSuite extends MomoCatsEffectSuite:
  override def munitTests(): Seq[munit.Test] = super.munitTests()
    .map(_.tag(TestTags.Integration).tag(TestTags.RedisIntegration))

  protected def redisUrlResource: Resource[IO, String] = redisContainer
    .map(container => s"redis://${container.getHost}:${container.getMappedPort(6379)}")

  private def redisContainer: Resource[IO, GenericContainer[?]] = Resource.make {
    IO.blocking {
      val container = new GenericContainer(DockerImageName.parse("redis:7-alpine"))
      container.addExposedPort(6379)
      container.start()
      container
    }
  }(container => IO.blocking(container.stop()))
end RedisIntegrationSuite
