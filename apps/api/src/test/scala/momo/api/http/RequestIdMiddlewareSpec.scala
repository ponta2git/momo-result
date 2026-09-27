package momo.api.http

import java.util.concurrent.Executors

import scala.concurrent.ExecutionContext

import cats.data.Kleisli
import cats.effect.{Deferred, IO, Resource}
import org.http4s.{Header, HttpApp, Request, Response, Status}
import org.slf4j.MDC

import momo.api.MomoCatsEffectSuite

final class RequestIdMiddlewareSpec extends MomoCatsEffectSuite:
  test("a suspended request never leaves its correlation id on a shared executor thread") {
    Resource.fromAutoCloseable(IO(Executors.newSingleThreadExecutor())).use { executor =>
      val executionContext = ExecutionContext.fromExecutor(executor)
      (for
        entered <- Deferred[IO, Unit]
        release <- Deferred[IO, Unit]
        app: HttpApp[IO] = RequestIdMiddleware[IO](Kleisli { request =>
          entered.complete(()) *> release.get.as(
            Response[IO](Status.Ok).withEntity(
              request.headers.get(RequestIdMiddleware.HeaderName).map(_.head.value).getOrElse("")
            )
          )
        })
        request =
          Request[IO]().putHeaders(Header.Raw(RequestIdMiddleware.HeaderName, "request-one"))
        _ <- Resource.make(app.run(request).start)(_.cancel).use { fiber =>
          for
            _ <- entered.get
            unrelatedContext <- IO(Option(MDC.get(RequestIdMiddleware.MdcKey)))
            _ <- release.complete(())
            response <- fiber.joinWithNever
            body <- response.as[String]
          yield
            assertEquals(unrelatedContext, None)
            assertEquals(body, "request-one")
            assertEquals(
              response.headers.get(RequestIdMiddleware.HeaderName).map(_.head.value),
              Some("request-one"),
            )
        }
      yield ()).evalOn(executionContext)
    }
  }
