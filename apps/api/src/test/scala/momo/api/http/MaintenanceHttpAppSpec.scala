package momo.api.http

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.{Deferred, IO, Ref}
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import io.circe.parser.parse
import org.http4s.{Header, Headers, Method, Request, Response, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.maintenance.MaintenanceDrain
import momo.api.maintenance.MaintenanceDrain.Stage

final class MaintenanceHttpAppSpec extends MomoCatsEffectSuite:
  private val token = "maintenance-test-token-00000000000000"
  private val input = MaintenanceDrain.Request("cutover-test", 1, Stage.Admission)
  private val body = "{\"cutoverId\":\"cutover-test\",\"stopEpoch\":1,\"stage\":\"admission\"}"
  private val authorization = Header.Raw(CIString("Authorization"), "Bearer " + token)

  private def control(): Request[IO] = control(Method.GET, body)
  private def control(method: Method): Request[IO] = control(method, body)
  private def control(method: Method, value: String): Request[IO] =
    Request[IO](method, Uri.unsafeFromString(MaintenanceHttpApp.Path)).withEntity(value)
      .putHeaders(authorization, Header.Raw(CIString("Content-Type"), "application/json"))

  private def phase(drain: MaintenanceDrain[IO]): IO[String] = drain.snapshot
    .flatMap(_.hcursor.get[String]("phase").liftTo[IO])

  private def waitFor(drain: MaintenanceDrain[IO], expected: String): IO[Unit] =
    def loop: IO[Unit] = phase(drain).flatMap { observed =>
      if observed == expected then IO.unit else IO.sleep(1.millis) *> loop
    }
    loop.timeout(2.seconds)

  test("admission preserves existing response I/O and all waits for continuations and cleanup"):
    MaintenanceDrain.resource[IO]().use { drain =>
      for
        originalStarted <- Deferred[IO, Unit]
        originalDone <- Deferred[IO, Unit]
        continuationStarted <- Deferred[IO, Unit]
        continuationDone <- Deferred[IO, Unit]
        cleanupStarted <- Deferred[IO, Unit]
        cleanupDone <- Deferred[IO, Unit]
        calls <- Ref.of[IO, Int](0)
        _ <- drain.setRelease(cleanupStarted.complete(()).void *> cleanupDone.get)
        underlying = Kleisli { (request: Request[IO]) =>
          val work =
            if request.uri.path.renderString == "/api/ocr-jobs/existing" then
              continuationStarted.complete(()).void *> continuationDone.get
            else originalStarted.complete(()).void *> originalDone.get
          calls.update(_ + 1).as(Response[IO](Status.Ok).withBodyStream(Stream.eval(work).drain))
        }
        app = MaintenanceHttpApp(underlying, drain, Some(token))
        original <- app.run(Request[IO](uri = Uri.unsafeFromString("/api/auth/callback")))
        originalBody <- original.body.compile.drain.start
        _ <- originalStarted.get
        accepted <- app.run(control(Method.POST))
        before <- phase(drain)
        refused <- app.run(Request[IO](uri = Uri.unsafeFromString("/api/auth/callback")))
        _ <- originalDone.complete(())
        _ <- originalBody.joinWithNever
        _ <- waitFor(drain, "drained")
        continued <- app.run(Request[IO](uri = Uri.unsafeFromString("/api/ocr-jobs/existing")))
        continuedBody <- continued.body.compile.drain.start
        _ <- continuationStarted.get
        all <- drain.request(input.copy(stage = Stage.All))
        refusedContinuation <-
          app.run(Request[IO](uri = Uri.unsafeFromString("/api/ocr-jobs/existing")))
        duringContinuation <- phase(drain)
        cleanupBefore <- cleanupStarted.tryGet
        _ <- continuationDone.complete(())
        _ <- continuedBody.joinWithNever
        _ <- cleanupStarted.get
        duringCleanup <- phase(drain)
        _ <- cleanupDone.complete(())
        _ <- waitFor(drain, "drained")
        total <- calls.get
      yield
        assertEquals(accepted.status, Status.Accepted)
        assertEquals(before, "draining")
        assertEquals(refused.status, Status.ServiceUnavailable)
        assert(all)
        assertEquals(refusedContinuation.status, Status.ServiceUnavailable)
        assertEquals(duringContinuation, "draining")
        assertEquals(cleanupBefore, None)
        assertEquals(duringCleanup, "draining")
        assertEquals(total, 2)
    }

  test("a timed out drain retains its failure after late I/O settles and gates never reopen"):
    MaintenanceDrain.resource[IO](20.millis).use { drain =>
      for
        permit <- drain.acquireRequest(continuation = false)
        _ <- drain.request(input)
        _ <- waitFor(drain, "timed_out")
        _ <- permit.sequence_
        repeated <- drain.request(input)
        _ <- IO.cede
        after <- phase(drain)
        denied <- drain.acquireRequest(continuation = false)
      yield
        assert(repeated)
        assertEquals(after, "timed_out")
        assertEquals(denied.isEmpty, true)
    }

  test("all resource failure is terminal and safe; repeated requests never repeat cleanup"):
    MaintenanceDrain.resource[IO]().use { drain =>
      for
        calls <- Ref.of[IO, Int](0)
        _ <- drain.setRelease(calls.update(_ + 1) *>
          IO.raiseError(new RuntimeException("database-secret")))
        accepted <- drain.request(input.copy(stage = Stage.All))
        _ <- waitFor(drain, "failed")
        repeated <- drain.request(input.copy(stage = Stage.All))
        conflicts <- List(
          input,
          input.copy(cutoverId = "another", stage = Stage.All),
          input.copy(stopEpoch = 2, stage = Stage.All)
        ).traverse(drain.request)
        snapshot <- drain.snapshot
        total <- calls.get
      yield
        assert(accepted && repeated)
        assertEquals(conflicts, List(false, false, false))
        assertEquals(total, 1)
        assert(!snapshot.noSpaces.contains("database-secret"))
    }

  test("operations authentication and bounded strict input precede every state transition"):
    MaintenanceDrain.resource[IO]().use { drain =>
      val app =
        MaintenanceHttpApp(Kleisli.liftF(IO.pure(Response[IO](Status.Ok))), drain, Some(token))
      for
        missing <- app.run(control(Method.POST).withHeaders(Headers.empty))
        duplicate <-
          app.run(control(Method.POST).withHeaders(Headers(authorization, authorization)))
        invalid <- List(
          body.replace("\"stopEpoch\":1", "\"stopEpoch\":0"),
          body.replace("\"stopEpoch\":1", "\"stopEpoch\":9007199254740992"),
          body.replace("cutover-test", "bad cutover"),
          body.replace("admission", "frozen"),
          body.dropRight(1) + ",\"extra\":true}",
        ).traverse(value => app.run(control(Method.POST, value)).map(_.status))
        tooLarge <- app.run(control(Method.POST, " " * 513))
        snapshot <-
          app.run(control()).flatMap(_.as[String]).flatMap(value => parse(value).liftTo[IO])
      yield
        assertEquals(missing.status, Status.Unauthorized)
        assertEquals(duplicate.status, Status.Unauthorized)
        assertEquals(invalid, List.fill(5)(Status.BadRequest))
        assertEquals(tooLarge.status, Status.PayloadTooLarge)
        assertEquals(snapshot.hcursor.get[String]("phase"), Right("running"))
        assertEquals(snapshot.hcursor.downField("cutoverId").focus, Some(Json.Null))
    }
