package momo.api.usecases.queue

import scala.concurrent.duration.*

import cats.effect.testkit.TestControl
import cats.effect.{IO, Ref, Temporal}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite

final class WorkerWakeRelaySpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  test("notifies on startup, stays idle without polling, and coalesces duplicate wakeups"):
    TestControl.executeEmbed {
      WorkerWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          notifyWorker = recordingNotifier(calls)(_ => IO.unit)
          relay = WorkerWakeRelay[IO](
            WorkerWakeKind.ProcessingJobs,
            wakeup,
            notifyWorker,
          )
          fiber <- relay.run.start
          _ <- awaitCalls(calls, 1)
          _ <- Temporal[IO].sleep(1.hour)
          startupCalls <- calls.get
          _ <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
          _ <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
          _ <- awaitCalls(calls, 2)
          wakeCalls <- calls.get
          _ <- fiber.cancel
        yield
          assertEquals(startupCalls, 1)
          assertEquals(wakeCalls, 2)
      }
    }

  test("retains wake demand during 1, 2 second error backoffs without early notifications"):
    TestControl.executeEmbed {
      WorkerWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          notifyWorker = recordingNotifier(calls) { index =>
            if index < 2 then IO.raiseError(new IllegalStateException("dependency unavailable"))
            else IO.unit
          }
          relay = WorkerWakeRelay[IO](
            WorkerWakeKind.ProcessingJobs,
            wakeup,
            notifyWorker,
          )
          fiber <- relay.run.start
          _ <- awaitCalls(calls, 1)
          _ <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
          _ <- Temporal[IO].sleep(999.millis)
          beforeFirstRetry <- calls.get
          _ <- Temporal[IO].sleep(1.millis) >> awaitCalls(calls, 2)
          firstRetry <- calls.get
          _ <- Temporal[IO].sleep(1999.millis)
          beforeSecondRetry <- calls.get
          _ <- Temporal[IO].sleep(1.millis) >> awaitCalls(calls, 3)
          secondRetry <- calls.get
          _ <- fiber.cancel
        yield
          assertEquals(beforeFirstRetry, 1)
          assertEquals(firstRetry, 2)
          assertEquals(beforeSecondRetry, 2)
          assertEquals(secondRetry, 3)
      }
    }

  test("reports unexpected completion but not resource cancellation"):
    for
      exits <- Ref.of[IO, List[String]](Nil)
      report = (error: Throwable) => exits.update(_ :+ error.getClass.getSimpleName)
      _ <- WorkerWakeRelay.observeTermination(
        IO.unit,
        WorkerWakeKind.ProcessingJobs,
        report,
      )
      afterCompletion <- exits.get
      fiber <- WorkerWakeRelay.observeTermination(
        IO.never[Unit],
        WorkerWakeKind.ProcessingJobs,
        report,
      ).start
      _ <- fiber.cancel
      afterCancellation <- exits.get
    yield
      assertEquals(afterCompletion, List("WorkerWakeRelayStopped"))
      assertEquals(afterCancellation, afterCompletion)

  private def recordingNotifier(
      calls: Ref[IO, Int]
  )(result: Int => IO[Unit]): IO[Unit] = calls.getAndUpdate(_ + 1).flatMap(result)

  private def awaitCalls(calls: Ref[IO, Int], expected: Int): IO[Unit] = calls.get.flatMap { value =>
    if value >= expected then IO.unit
    else IO.cede >> awaitCalls(calls, expected)
  }

end WorkerWakeRelaySpec
