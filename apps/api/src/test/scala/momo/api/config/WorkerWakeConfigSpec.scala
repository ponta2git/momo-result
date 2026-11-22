package momo.api.config

import cats.effect.IO

import momo.api.MomoCatsEffectSuite

final class WorkerWakeConfigSpec extends MomoCatsEffectSuite:
  private val token = "t" * 32
  private val machine = "test-writer"
  private val flyEnv = Map(
    "FLY_MACHINE_ID" -> machine,
    "FLY_PRIVATE_IP" -> "fdaa::1234",
    "WORKER_WAKE_TOKEN" -> token,
    "WORKER_WAKE_WRITER_IDS" -> s"other,$machine"
  )
  test("Fly binds its own private address and rejects unlisted writers before serving"):
    for
      valid <-
        WorkerWakeConfig.load[IO](flyEnv + ("WORKER_WAKE_BIND_HOST" -> "0.0.0.0"), AppEnv.Prod)
      unlisted <- WorkerWakeConfig.load[IO](
        flyEnv.updated("WORKER_WAKE_WRITER_IDS", "other"),
        AppEnv.Prod
      ).attempt
      publicIp <- WorkerWakeConfig.load[IO](
        flyEnv.updated("FLY_PRIVATE_IP", "2001:db8::1"),
        AppEnv.Prod
      ).attempt
    yield
      assertEquals(valid.map(_.host.toString), Some("fdaa::1234"))
      assertEquals(valid.map(_.port.value), Some(9091))
      assert(!valid.toString.contains(token))
      assert(unlisted.isLeft)
      assert(publicIp.isLeft)

  test("development defaults to loopback when configured and production requires a credential"):
    for
      local <- WorkerWakeConfig.load[IO](Map("WORKER_WAKE_TOKEN" -> token), AppEnv.Dev)
      absent <- WorkerWakeConfig.load[IO](Map.empty, AppEnv.Dev)
      prod <- WorkerWakeConfig.load[IO](Map.empty, AppEnv.Prod).attempt
      badPort <- WorkerWakeConfig.load[IO](
        Map("WORKER_WAKE_TOKEN" -> token, "WORKER_WAKE_PORT" -> "0"),
        AppEnv.Dev
      ).attempt
    yield
      assertEquals(local.map(_.host.toString), Some("127.0.0.1"))
      assert(absent.isEmpty)
      assert(prod.isLeft)
      assert(badPort.isLeft)
