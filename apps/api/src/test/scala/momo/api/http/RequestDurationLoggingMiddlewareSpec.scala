package momo.api.http

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.testkit.TestControl
import cats.effect.{Deferred, IO, Outcome, Resource}
import cats.~>
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.spi.ILoggingEvent
import fs2.Stream
import org.http4s.{Header, HttpApp, HttpVersion, Method, Request, Response, Status, Uri}

import momo.api.MomoCatsEffectSuite
import momo.api.testing.LogbackCapture

final class RequestDurationLoggingMiddlewareSpec extends MomoCatsEffectSuite:
  private val request = Request[IO](
    uri = Uri.unsafeFromString("/stream"),
    httpVersion = HttpVersion.`HTTP/2`,
  ).putHeaders(Header.Raw(RequestIdMiddleware.HeaderName, "request-stream-1"))

  List((Method.HEAD, Status.Ok), (Method.GET, Status.NoContent), (Method.GET, Status.NotModified))
    .foreach { case (method, status) =>
      test(s"${method.name} ${status.code} preserves cleanup without reporting a body transfer") {
        captureLogs { events =>
          for
            releases <- IO.ref(0)
            app = RequestDurationLoggingMiddleware[IO](Kleisli(_ =>
              IO.pure(Response[IO](status).withBodyStream(
                Stream.empty.onFinalize(releases.update(_ + 1))
              ))
            ))
            response <- app.run(request.withMethod(method))
            _ <- response.body.compile.drain
            released <- releases.get
            captured <- events
          yield
            assertEquals(released, 1)
            val logged = messages(captured)
            assertEquals(logged.count(_.startsWith("http_response_ready ")), 1)
            assert(!logged.exists(_.startsWith("http_response_transfer_completed ")))
        }
      }
    }

  test("logs readiness before pull and successful transfer only after the body is consumed"):
    val app = middleware(Stream.emits[IO, Byte](Array[Byte](1, 2, 3)))

    captureLogs { events =>
      for
        response <- app.run(request)
        beforePull <- events
        body <- response.body.compile.toList
        afterPull <- events
      yield
        assertEquals(body, List[Byte](1, 2, 3))
        assertEquals(messages(beforePull).count(_.startsWith("http_response_ready ")), 1)
        assert(!messages(beforePull).exists(_.startsWith("http_response_transfer_completed ")))
        val completed = messages(afterPull)
          .filter(_.startsWith("http_response_transfer_completed "))
        assertEquals(completed.size, 1)
        assert(completed.head.contains("httpVersion=HTTP/2.0"))
        assert(completed.head.contains("outcome=succeeded"))
        assert(completed.head.contains("bodyBytes=3"))
        assert(completed.head.contains("requestId=request-stream-1"))
        val completedEvent = afterPull
          .find(event =>
            event.getFormattedMessage.startsWith("http_response_transfer_completed ") &&
              event.getMDCPropertyMap.get("request_id") == "request-stream-1"
          )
          .getOrElse(fail("expected transfer-completed event"))
        assertEquals(completedEvent.getMDCPropertyMap.get("request_id"), "request-stream-1")
        val ready = messages(afterPull).find(_.startsWith("http_response_ready "))
          .getOrElse(fail("expected response-ready event"))
        assert(ready.contains("httpVersion=HTTP/2.0"))
    }

  test("logs an errored body once with only bytes pulled from the observed stream"):
    val failure = new RuntimeException("stream failed")
    val body = Stream.emits[IO, Byte](Array[Byte](1, 2)) ++ Stream.raiseError[IO](failure)
    val app = middleware(body)

    captureLogs { events =>
      for
        response <- app.run(request)
        result <- response.body.compile.drain.attempt
        captured <- events
      yield
        assertEquals(result, Left(failure))
        val completed = messages(captured)
          .filter(_.startsWith("http_response_transfer_completed "))
        assertEquals(completed.size, 1)
        assert(completed.head.contains("outcome=errored"))
        assert(completed.head.contains("bodyBytes=2"))
        assert(completed.head.contains("errorClass=java.lang.RuntimeException"))
        assert(!completed.head.contains(failure.getMessage))
    }

  test("logs cancellation once and does not report the transfer as successful"):
    for
      started <- Deferred[IO, Unit]
      release <- Deferred[IO, Unit]
      body = Stream.eval(started.complete(())) >> Stream.eval(release.get) >>
        Stream.emit[IO, Byte](1)
      _ <- captureLogs { events =>
        for
          response <- middleware(body).run(request)
          fiber <- response.body.compile.drain.start
          _ <- started.get
          _ <- fiber.cancel
          captured <- events
        yield
          val completed = messages(captured)
            .filter(_.startsWith("http_response_transfer_completed "))
          assertEquals(completed.size, 1)
          assert(completed.head.contains("outcome=canceled"))
          assert(completed.head.contains("bodyBytes=0"))
      }
    yield ()

  test("cancellation during response handoff preserves the body release for the consumer"):
    TestControl.executeEmbed {
      val readRequest = request.withUri(Uri.unsafeFromString("/api/matches"))
      for
        admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
        responseReady <- Deferred[IO, Unit]
        finishHandoff <- Deferred[IO, Unit]
        bodiesReleased <- IO.ref(0)
        admitted = admission(Kleisli[IO, Request[IO], Response[IO]](_ =>
          IO.pure(Response[IO](Status.Ok).withBodyStream(
            Stream.empty.onFinalize(bodiesReleased.update(_ + 1))
          ))
        ))
        // The response already owns the permit while this masked finalizer is running.
        // A cancellation must not lose it between the inner app and the logging wrapper.
        app = RequestDurationLoggingMiddleware[IO](Kleisli(value =>
          admitted.run(value).guaranteeCase {
            case Outcome.Succeeded(_) => responseReady.complete(()).void *> finishHandoff.get
            case _ => IO.unit
          }
        ))
        consumer = Resource.makeFull[IO, Response[IO]](poll => poll(app.run(readRequest)))(
          _.body.compile.drain
        )
        fiber <- consumer.use(_ => IO.never[Unit]).start
        _ <- responseReady.get
        cancellation <- fiber.cancel.start
        _ <- IO.sleep(1.millis)
        _ <- finishHandoff.complete(())
        outcome <- fiber.join
        _ <- cancellation.joinWithNever
        released <- bodiesReleased.get
        next <- app.run(readRequest)
        _ <- next.body.compile.drain
      yield
        assert(outcome match
          case Outcome.Canceled() => true
          case _ => false)
        assertEquals(released, 1)
        assertEquals(next.status, Status.Ok)
    }

  test("cancellation at the first body scope releases admission before transfer observation"):
    TestControl.executeEmbed {
      val readRequest = request.withUri(Uri.unsafeFromString("/api/matches"))
      for
        admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
        firstEffect <- IO.ref(true)
        app = RequestDurationLoggingMiddleware[IO](
          Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity("recovered"))),
          admission.apply,
        )
        response <- app.run(readRequest)
        // Cancel just as the leading body resource finishes acquisition. With observation
        // outside admission, only the observer finalizes and the next read stays busy.
        outcome <- response.body.translate(new (IO ~> IO):
          def apply[A](effect: IO[A]): IO[A] = firstEffect.getAndSet(false).flatMap { first =>
            if first then effect <* IO.canceled else effect
          }).compile.drain.start.flatMap(_.join)
        next <- app.run(readRequest)
        content <- next.bodyText.compile.string
      yield
        assert(outcome match
          case Outcome.Canceled() => true
          case _ => false)
        assertEquals(next.status, Status.Ok)
        assertEquals(content, "recovered")
    }

  test("admission denials retain readiness logging with the time spent queueing"):
    TestControl.executeEmbed {
      captureLogs { events =>
        val readRequest = request.withUri(Uri.unsafeFromString("/api/matches"))
        for
          admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
          app = RequestDurationLoggingMiddleware[IO](
            Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity("held"))),
            admission.apply,
          )
          first <- app.run(readRequest)
          denied <- app.run(readRequest)
          _ <- denied.body.compile.drain
          _ <- first.body.compile.drain
          captured <- events
        yield
          assertEquals(denied.status, Status.ServiceUnavailable)
          assert(messages(captured).exists(message =>
            message.startsWith("http_response_ready ") && message.contains("status=503") &&
              message.contains("handlerDurationMs=5000")
          ))
      }
    }

  private def middleware(body: Stream[IO, Byte]): HttpApp[IO] =
    RequestDurationLoggingMiddleware[IO](Kleisli(_ =>
      IO.pure(
        Response[IO](Status.Ok).withBodyStream(body)
      )
    ))

  private def messages(events: Vector[ILoggingEvent]): Vector[String] =
    events
      .filter(_.getMDCPropertyMap.get("request_id") == "request-stream-1")
      .map(_.getFormattedMessage)

  private def captureLogs[A](
      use: IO[Vector[ILoggingEvent]] => IO[A]
  ): IO[A] = LogbackCapture.withEvents(
    "momo.api.http.RequestDurationLoggingMiddleware",
    Level.INFO,
  )(use)
