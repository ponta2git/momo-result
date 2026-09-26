package momo.api.http

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.testkit.TestControl
import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import org.http4s.{Method, Request, Response, Status, Uri}

import momo.api.MomoCatsEffectSuite

final class RequestBodyAdmissionSpec extends MomoCatsEffectSuite:
  private def upload: Request[IO] =
    Request[IO](Method.POST, Uri.unsafeFromString("/api/uploads/images"))
  private def image: Request[IO] = Request[IO](
    Method.GET,
    Uri.unsafeFromString("/api/match-drafts/example/source-images/total_assets")
  )
  private def archive: Request[IO] =
    Request[IO](Method.GET, Uri.unsafeFromString("/api/match-drafts/example/source-images.zip"))
  private val consumingApp = Kleisli[IO, Request[IO], Response[IO]](request =>
    request.body.compile.drain.as(Response[IO](Status.Ok))
  )

  test("a screen's parallel JSON reads share capacity until every response body completes") {
    TestControl.executeEmbed {
      for
        admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 2L)
        usage <- IO.ref((0, 0))
        app = admission(Kleisli[IO, Request[IO], Response[IO]](_ =>
          usage.update((active, peak) => (active + 1, math.max(peak, active + 1))).as(
            Response[IO](Status.Ok).withBodyStream(
              (Stream.sleep_[IO](1.millis) ++ Stream.emit[IO, Byte](1))
                .onFinalize(usage.update((active, peak) => (active - 1, peak)))
            )
          )
        ))
        statuses <- List.fill(8)(Request[IO](Method.GET, Uri.unsafeFromString("/%61pi/matches")))
          .parTraverse(request =>
            app.run(request).flatMap(response => response.body.compile.drain.as(response.status))
          )
        observed <- usage.get
      yield
        assert(statuses.forall(_.code == Status.Ok.code))
        assertEquals(observed, (0, 2))
    }
  }

  test("the JSON read queue rejects excess waiters and cancellation returns its capacity") {
    TestControl.executeEmbed {
      val request = Request[IO](Method.GET, Uri.unsafeFromString("/api/matches"))
      for
        admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
        app = admission(consumingApp)
        first <- app.run(request)
        waiters <- List.fill(16)(request).traverse(value => app.run(value).start)
        _ <- IO.sleep(1.millis)
        excess <- app.run(request)
        _ <- waiters.traverse_(_.cancel)
        _ <- first.body.compile.drain
        next <- app.run(request)
        _ <- next.body.compile.drain
      yield
        assertEquals(excess.status, Status.ServiceUnavailable)
        assertEquals(next.status, Status.Ok)
    }
  }

  test(
    "busy uploads reject before body consumption and preserve capacity for reads and ordinary writes"
  ) {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      started <- Deferred[IO, Unit]
      consumed <- IO.ref(false)
      app = admission(consumingApp)
      first <- app.run(upload.withBodyStream(
        Stream.exec(started.complete(()).void) ++ Stream.never[IO]
      )).start
      result <- (for
        _ <- started.get
        busy <- app.run(upload.withUri(Uri.unsafeFromString("/%61pi/uploads/%69mages"))
          .withBodyStream(Stream.exec(consumed.set(true))))
        read <- app.run(Request[IO](Method.GET, Uri.unsafeFromString("/api/matches")))
        write <- app.run(Request[IO](Method.POST, Uri.unsafeFromString("/api/matches")))
        pulled <- consumed.get
      yield (busy, read, write, pulled)).guarantee(first.cancel)
      retried <- app.run(upload)
    yield
      assertEquals(result._1.status, Status.ServiceUnavailable)
      assert(result._1.headers.headers.exists(header =>
        header.name.toString == "Retry-After" && header.value == "1"
      ))
      assertEquals(result._2.status, Status.Ok)
      assertEquals(result._3.status, Status.Ok)
      assertEquals(result._4, false)
      assertEquals(retried.status, Status.Ok)
  }

  test("body failure and successful completion both release mutation capacity") {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      app = admission(consumingApp)
      request = Request[IO](Method.PUT, Uri.unsafeFromString("/api/matches/example"))
      error = new RuntimeException("interrupted test body")
      failed <- app.run(request.withBodyStream(Stream.raiseError[IO](error))).attempt
      recovered <- app.run(request)
      next <- app.run(request)
    yield
      assert(failed.left.exists(_ eq error))
      assertEquals(recovered.status, Status.Ok)
      assertEquals(next.status, Status.Ok)
  }

  test("image and ZIP downloads share a bound held until the response body is consumed") {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      handlers <- IO.ref(0)
      reads <- IO.ref(0)
      underlying = Kleisli[IO, Request[IO], Response[IO]](_ =>
        handlers.update(_ + 1).as(
          Response[IO](Status.Ok).withBodyStream(
            Stream.exec(reads.update(_ + 1)) ++ Stream.emits[IO, Byte](List(1, 2))
          )
        )
      )
      app = admission(underlying)
      first <- app.run(image)
      encodedArchive =
        archive.withUri(Uri.unsafeFromString("/%61pi/match-drafts/example/source-images%2ezip"))
      busyArchive <- app.run(encodedArchive)
      encodedImage = image.withUri(
        Uri.unsafeFromString("/api/match-drafts/example/%73ource-images/total_assets")
      )
      busyImage <- app.run(encodedImage)
      handlersBefore <- handlers.get
      readsBefore <- reads.get
      _ <- first.body.take(1).compile.drain
      next <- app.run(encodedArchive)
      _ <- next.body.compile.drain
      totalReads <- reads.get
    yield
      assertEquals(first.status, Status.Ok)
      assertEquals(busyArchive.status, Status.ServiceUnavailable)
      assertEquals(busyImage.status, Status.ServiceUnavailable)
      assertEquals(handlersBefore, 1)
      assertEquals(readsBefore, 0)
      assertEquals(next.status, Status.Ok)
      assertEquals(totalReads, 2)
  }

  test("a failed download body releases its permit") {
    val error = new RuntimeException("download body interrupted")
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      fail <- IO.ref(true)
      app = admission(Kleisli[IO, Request[IO], Response[IO]](_ =>
        fail.getAndSet(false).map(shouldFail =>
          Response[IO](Status.Ok).withBodyStream(
            if shouldFail then Stream.raiseError[IO](error) else Stream.empty
          )
        )
      ))
      response <- app.run(image)
      failure <- response.body.compile.drain.attempt
      recovered <- app.run(archive)
      _ <- recovered.body.compile.drain
      next <- app.run(image)
      _ <- next.body.compile.drain
    yield
      assert(failure.left.exists(_ eq error))
      assertEquals(recovered.status, Status.Ok)
      assertEquals(next.status, Status.Ok)
  }

  test(
    "exports retain an independent permit until the body completes without blocking images or ordinary reads"
  ) {
    val exportRequest =
      Request[IO](Method.GET, Uri.unsafeFromString("/api/exports/matches?format=csv"))
    val encodedExport = Request[IO](
      Method.GET,
      Uri.unsafeFromString("/%61pi/exports/%6datches?format=tsv&seasonMasterId=example")
    )
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      entered <- IO.ref(List.empty[String])
      app = admission(Kleisli[IO, Request[IO], Response[IO]](request =>
        entered.update(HttpRequestPaths.segments(request).mkString("/") :: _).as(
          Response[IO](Status.Ok).withBodyStream(Stream.emits[IO, Byte](List(1, 2)))
        )
      ))
      first <- app.run(exportRequest)
      busy <- app.run(encodedExport)
      downloadedImage <- app.run(image)
      ordinary <- app.run(Request[IO](Method.GET, Uri.unsafeFromString("/api/matches")))
      before <- entered.get
      _ <- downloadedImage.body.compile.drain
      _ <- ordinary.body.compile.drain
      _ <- first.body.compile.drain
      next <- app.run(encodedExport)
      _ <- next.body.compile.drain
    yield
      assertEquals(first.status, Status.Ok)
      assertEquals(busy.status, Status.ServiceUnavailable)
      assertEquals(before.count(_ == "api/exports/matches"), 1)
      assertEquals(downloadedImage.status, Status.Ok)
      assertEquals(ordinary.status, Status.Ok)
      assertEquals(next.status, Status.Ok)
  }

  test("cancelling a download body releases capacity only after the body terminates") {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      started <- Deferred[IO, Unit]
      waiting <- IO.ref(true)
      app = admission(Kleisli[IO, Request[IO], Response[IO]](_ =>
        waiting.get.map { wait =>
          Response[IO](Status.Ok).withBodyStream(
            if wait then Stream.exec(started.complete(()).void) ++ Stream.never[IO]
            else Stream.empty
          )
        }
      ))
      first <- app.run(image)
      busy <- Resource.make(first.body.compile.drain.start)(_.cancel).use { _ =>
        started.get *> app.run(archive)
      }
      _ <- waiting.set(false)
      next <- app.run(archive)
      _ <- next.body.compile.drain
    yield
      assertEquals(busy.status, Status.ServiceUnavailable)
      assertEquals(next.status, Status.Ok)
  }

  test("handler failures and cancellation release download capacity before a body exists") {
    val error = new RuntimeException("download lookup interrupted")
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      started <- Deferred[IO, Unit]
      behavior <- IO.ref[IO[Response[IO]]](IO.raiseError(error))
      app = admission(Kleisli[IO, Request[IO], Response[IO]](_ => behavior.get.flatten))
      failure <- app.run(image).attempt
      _ <- behavior.set(started.complete(()).void *> IO.never[Response[IO]])
      busy <-
        Resource.make(app.run(image).start)(_.cancel).use(_ => started.get *> app.run(archive))
      _ <- behavior.set(IO.pure(Response[IO](Status.Ok)))
      next <- app.run(archive)
      _ <- next.body.compile.drain
    yield
      assert(failure.left.exists(_ eq error))
      assertEquals(busy.status, Status.ServiceUnavailable)
      assertEquals(next.status, Status.Ok)
  }

  test("concurrent download admission never overbooks or loses permits") {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      app = admission(Kleisli[IO, Request[IO], Response[IO]](_ => IO.pure(Response[IO](Status.Ok))))
      results <- List.fill(2)(()).traverse { _ =>
        List.fill(32)(image).parTraverse(app.run).flatMap { responses =>
          responses.traverse_(response => response.body.compile.drain).as(
            responses.map(_.status)
          )
        }
      }
    yield results.foreach { statuses =>
      assertEquals(statuses.count(_.code == Status.Ok.code), 1)
      assertEquals(statuses.count(_.code == Status.ServiceUnavailable.code), 31)
    }
  }
