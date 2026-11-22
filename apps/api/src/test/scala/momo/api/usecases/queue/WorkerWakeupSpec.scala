package momo.api.usecases.queue

import scala.concurrent.duration.*

import cats.effect.IO
import cats.effect.testkit.TestControl

import momo.api.MomoCatsEffectSuite

final class WorkerWakeupSpec extends MomoCatsEffectSuite:
  test("both waiters observe a wake, including one registering just after it"):
    for
      state <- WorkerWakeup.create[IO]
      before <- state.await(None)
      waiter <- state.await(Some(before)).start
      accepted <- state.advance
      late <- state.await(Some(before))
      early <- waiter.joinWithNever
    yield
      assertEquals(accepted.boot, before.boot)
      assertEquals(accepted.counter, before.counter + 1L)
      assertEquals(late, accepted)
      assertEquals(early, accepted)

  test("unchanged long poll returns the same cursor at 30 seconds"):
    TestControl.executeEmbed {
      for
        state <- WorkerWakeup.create[IO]
        before <- state.await(None)
        result <- state.await(Some(before)).timed
      yield assertEquals(result, (30.seconds, before))
    }

  test("an uncertain outcome or restart forces recovery even at the same counter"):
    for
      state <- WorkerWakeup.create[IO]
      before <- state.await(None)
      changed <- state.invalidate
      after <- state.await(Some(before))
      restart <- WorkerWakeup.create[IO]
      restarted <- restart.await(Some(after))
    yield
      assertNotEquals(changed.boot, before.boot)
      assertEquals(after, changed)
      assertNotEquals(restarted.boot, changed.boot)
