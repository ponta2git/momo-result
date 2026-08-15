package momo.api.usecases.queue

import scala.concurrent.duration.*

import cats.effect.testkit.TestControl
import cats.effect.{Clock, IO, Ref}
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite

final class OutboxWakeCoordinatorSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  test("drains on startup and coalesces duplicate local wakeups"):
    TestControl.executeEmbed {
      OutboxWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          driver = recordingDriver(calls)(_ => IO.pure(OutboxDrainResult.Idle(None)))
          coordinator = OutboxWakeCoordinator[IO](
            OutboxKind.Ocr,
            wakeup,
            driver,
            OutboxWakeCoordinatorConfig(coldRecoveryInterval = None),
          )
          fiber <- coordinator.run.start
          _ <- awaitCalls(calls, 1)
          startupCalls <- calls.get
          _ <- wakeup.submit(PostCommitEffects.wake(OutboxKind.Ocr))
          _ <- wakeup.submit(PostCommitEffects.wake(OutboxKind.Ocr))
          _ <- awaitCalls(calls, 2)
          wakeCalls <- calls.get
          _ <- fiber.cancel
        yield
          assertEquals(startupCalls, 1)
          assertEquals(wakeCalls, 2)
      }
    }

  test("uses the earliest driver deadline without polling before it"):
    TestControl.executeEmbed {
      OutboxWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          driver = recordingDriver(calls) { index =>
            if index == 0 then
              Clock[IO].realTimeInstant.map(now =>
                OutboxDrainResult.Idle(Some(now.plusSeconds(5)))
              )
            else IO.pure(OutboxDrainResult.Idle(None))
          }
          coordinator = OutboxWakeCoordinator[IO](
            OutboxKind.SeriesAnalysis,
            wakeup,
            driver,
            OutboxWakeCoordinatorConfig(coldRecoveryInterval = None),
          )
          fiber <- coordinator.run.start
          _ <- awaitCalls(calls, 1)
          _ <- IO.sleep(4999.millis)
          before <- calls.get
          _ <- IO.sleep(1.millis) >> awaitCalls(calls, 2)
          atDeadline <- calls.get
          _ <- fiber.cancel
        yield
          assertEquals(before, 1)
          assertEquals(atDeadline, 2)
      }
    }

  test("runs cold recovery only at its configured one-shot deadline"):
    TestControl.executeEmbed {
      OutboxWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          driver = recordingDriver(calls)(_ => IO.pure(OutboxDrainResult.Idle(None)))
          coordinator = OutboxWakeCoordinator[IO](
            OutboxKind.Ocr,
            wakeup,
            driver,
            OutboxWakeCoordinatorConfig(coldRecoveryInterval = Some(10.seconds)),
          )
          fiber <- coordinator.run.start
          _ <- awaitCalls(calls, 1)
          _ <- IO.sleep(9999.millis)
          before <- calls.get
          _ <- IO.sleep(1.millis) >> awaitCalls(calls, 2)
          atDeadline <- calls.get
          _ <- fiber.cancel
        yield
          assertEquals(before, 1)
          assertEquals(atDeadline, 2)
      }
    }

  test("retains wake demand during 1, 2 second error backoffs without early drains"):
    TestControl.executeEmbed {
      OutboxWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          driver = recordingDriver(calls) { index =>
            if index < 2 then IO.raiseError(new IllegalStateException("dependency unavailable"))
            else IO.pure(OutboxDrainResult.Idle(None))
          }
          coordinator = OutboxWakeCoordinator[IO](
            OutboxKind.SeriesAnalysis,
            wakeup,
            driver,
            OutboxWakeCoordinatorConfig(coldRecoveryInterval = None),
          )
          fiber <- coordinator.run.start
          _ <- awaitCalls(calls, 1)
          _ <- wakeup.submit(PostCommitEffects.wake(OutboxKind.SeriesAnalysis))
          _ <- IO.sleep(999.millis)
          beforeFirstRetry <- calls.get
          _ <- IO.sleep(1.millis) >> awaitCalls(calls, 2)
          firstRetry <- calls.get
          _ <- IO.sleep(1999.millis)
          beforeSecondRetry <- calls.get
          _ <- IO.sleep(1.millis) >> awaitCalls(calls, 3)
          secondRetry <- calls.get
          _ <- fiber.cancel
        yield
          assertEquals(beforeFirstRetry, 1)
          assertEquals(firstRetry, 2)
          assertEquals(beforeSecondRetry, 2)
          assertEquals(secondRetry, 3)
      }
    }

  test("self-wakes after the consecutive batch budget"):
    TestControl.executeEmbed {
      OutboxWakeup.resource[IO].use { wakeup =>
        for
          calls <- Ref.of[IO, Int](0)
          driver = recordingDriver(calls) { index =>
            IO.pure(if index < 2 then OutboxDrainResult.Progress else OutboxDrainResult.Idle(None))
          }
          coordinator = OutboxWakeCoordinator[IO](
            OutboxKind.Ocr,
            wakeup,
            driver,
            OutboxWakeCoordinatorConfig(
              coldRecoveryInterval = None,
              maxConsecutiveBatches = 2,
            ),
          )
          fiber <- coordinator.run.start
          _ <- awaitCalls(calls, 3)
          actual <- calls.get
          _ <- fiber.cancel
        yield assertEquals(actual, 3)
      }
    }

  private def recordingDriver(
      calls: Ref[IO, Int]
  )(result: Int => IO[OutboxDrainResult]): OutboxWakeDriver[IO] = new OutboxWakeDriver[IO]:
    override def drainBatch: IO[OutboxDrainResult] = calls.getAndUpdate(_ + 1).flatMap(result)

  private def awaitCalls(calls: Ref[IO, Int], expected: Int): IO[Unit] = calls.get.flatMap { value =>
    if value >= expected then IO.unit
    else IO.cede >> awaitCalls(calls, expected)
  }

end OutboxWakeCoordinatorSpec
