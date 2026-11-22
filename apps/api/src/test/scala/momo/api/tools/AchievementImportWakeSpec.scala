package momo.api.tools

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import com.comcast.ip4s.*
import doobie.implicits.*
import org.http4s.ember.server.EmberServerBuilder

import momo.api.config.{AppEnv, WorkerWakeConfig}
import momo.api.db.Database
import momo.api.http.WorkerWakeServer
import momo.api.integration.IntegrationSuite
import momo.api.usecases.queue.WorkerWakeup

final class AchievementImportWakeSpec extends IntegrationSuite:
  test(
    "import marks the epoch uncertain before its bounded transaction writes and signals after commit"
  ):
    val token = "w" * 32
    def config(port: Int, key: String) = WorkerWakeConfig.load[IO](
      Map("WORKER_WAKE_TOKEN" -> key, "WORKER_WAKE_PORT" -> port.toString),
      AppEnv.Test
    ).map(_.get)
    val server =
      for
        wake <- Resource.eval(WorkerWakeup.create[IO])
        auth <- Resource.eval(config(9091, token))
        listening <- EmberServerBuilder.default[IO].withHost(host"127.0.0.1").withPort(port"0")
          .withHttpApp(WorkerWakeServer.routes(auth, wake)).build
        xa <- Database.transactor[IO](dbFixture().databaseConfig)
      yield (wake, listening.address.getPort, xa)
    server.use { (wake, port, xa) =>
      val boundedWrite = sql"""
        SELECT current_setting('transaction_timeout')::interval = interval '120 seconds'
      """.query[Boolean].unique
        .ensure(new IllegalStateException("unbounded import transaction"))(identity).void
      for
        valid <- config(port, token)
        wrong <- config(port, "x" * 32)
        before <- wake.await(None)
        denied <- AchievementImportWake.transact(Some(wrong), boundedWrite, xa).attempt
        afterDenied <- wake.await(None)
        _ <- AchievementImportWake.transact(Some(valid), boundedWrite, xa)
        after <- wake.await(None)
      yield
        assert(denied.isLeft)
        assertEquals(before, afterDenied)
        assertNotEquals(after.boot, before.boot)
        assertEquals(after.counter, 1L)
    }
