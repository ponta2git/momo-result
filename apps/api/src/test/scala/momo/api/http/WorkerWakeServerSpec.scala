package momo.api.http

import cats.effect.IO
import io.circe.parser.parse
import org.http4s.implicits.*
import org.http4s.{Header, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.config.{AppEnv, WorkerWakeConfig}
import momo.api.usecases.queue.WorkerWakeup

final class WorkerWakeServerSpec extends MomoCatsEffectSuite:
  private val token = "w" * 32
  private val fingerprint = Header.Raw(CIString("Authorization"), s"Bearer $token")
  private val path = uri"/internal/worker/wake"

  test("private endpoint authenticates both methods and returns the cursor as a JSON integer"):
    for
      config <- WorkerWakeConfig.load[IO](Map("WORKER_WAKE_TOKEN" -> token), AppEnv.Test)
      wake <- WorkerWakeup.create[IO]
      app = WorkerWakeServer.routes(config.get, wake)
      initial <- wake.await(None)
      denied <- app.run(Request[IO](Method.POST, path))
      deniedRead <- app.run(Request[IO](Method.GET, path))
      unchanged <- wake.await(None)
      posted <- app.run(Request[IO](Method.POST, path).putHeaders(fingerprint))
      body <- posted.as[String]
      changed <- app.run(Request[IO](
        Method.GET,
        Uri.unsafeFromString(s"$path?boot=${initial.boot}&cursor=0")
      ).putHeaders(fingerprint))
      malformed <- app.run(Request[IO](
        Method.GET,
        uri"/internal/worker/wake?cursor=1"
      ).putHeaders(fingerprint))
      invalidated <- app.run(Request[IO](
        Method.POST,
        uri"/internal/worker/wake?uncertain=true"
      ).putHeaders(fingerprint))
      after <- wake.await(None)
    yield
      assertEquals(denied.status, Status.Unauthorized)
      assertEquals(deniedRead.status, Status.Unauthorized)
      assertEquals(unchanged, initial)
      assertEquals(posted.status, Status.Ok)
      assertEquals(parse(body).toOption.flatMap(_.hcursor.get[Long]("cursor").toOption), Some(1L))
      assertEquals(changed.status, Status.Ok)
      assertEquals(malformed.status, Status.BadRequest)
      assertEquals(invalidated.status, Status.Ok)
      assertNotEquals(after.boot, initial.boot)
