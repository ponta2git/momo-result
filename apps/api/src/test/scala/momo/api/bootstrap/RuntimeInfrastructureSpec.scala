package momo.api.bootstrap

import java.nio.file.Paths
import java.time.Instant

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppConfig, AppEnv}

final class RuntimeInfrastructureSpec extends MomoCatsEffectSuite:
  test("a runtime without Redis still provides the OCR queue boundary"):
    val config = AppConfig(
      appEnv = AppEnv.Test,
      httpHost = "127.0.0.1",
      httpPort = 0,
      imageTmpDir = Paths.get("target/runtime-infrastructure-test"),
      devMemberIds = List("member_ponta"),
    )

    RuntimeInfrastructure.resource[IO](config, IO.pure(Instant.EPOCH)).use { infrastructure =>
      infrastructure.queueHealth.deadLetterLength.map(length => assertEquals(length, 0L))
    }

end RuntimeInfrastructureSpec
