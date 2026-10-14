package momo.api.usecases.queue

import cats.effect.IO

import momo.api.MomoCatsEffectSuite

final class WorkerWakeupSpec extends MomoCatsEffectSuite:
  test("coalesces duplicate capacity-one signals independently for each kind"):
    WorkerWakeup.resource[IO].use { wakeup =>
      for
        first <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
        duplicate <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
        both <- wakeup.submit(PostCommitEffects.wakeAll(
          WorkerWakeKind.ProcessingJobs,
          WorkerWakeKind.OcrSubmissions,
        ))
        ocr <- wakeup.tryAwait(WorkerWakeKind.ProcessingJobs)
        duplicateOcr <- wakeup.tryAwait(WorkerWakeKind.ProcessingJobs)
        submission <- wakeup.tryAwait(WorkerWakeKind.OcrSubmissions)
      yield
        assertEquals(first, WorkerWakeSubmitResult.Accepted)
        assertEquals(duplicate, WorkerWakeSubmitResult.Accepted)
        assertEquals(both, WorkerWakeSubmitResult.Accepted)
        assertEquals(ocr, Some(()))
        assertEquals(duplicateOcr, None)
        assertEquals(submission, Some(()))
    }

  test("canceling a waiter does not consume a later signal"):
    WorkerWakeup.resource[IO].use { wakeup =>
      for
        waiter <- wakeup.await(WorkerWakeKind.ProcessingJobs).start
        _ <- IO.cede
        _ <- waiter.cancel
        _ <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
        signal <- wakeup.tryAwait(WorkerWakeKind.ProcessingJobs)
      yield assertEquals(signal, Some(()))
    }

  test("closed sink reports closure without failing or accepting new demand"):
    for
      wakeup <- WorkerWakeup.create[IO]
      _ <- wakeup.close
      result <- wakeup.submit(PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs))
      signal <- wakeup.tryAwait(WorkerWakeKind.ProcessingJobs)
    yield
      assertEquals(result, WorkerWakeSubmitResult.Closed)
      assertEquals(signal, None)

  test("post-commit effects combine as a kind set without duplicate demand"):
    val effects = PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs) ++
      PostCommitEffects.wake(WorkerWakeKind.ProcessingJobs) ++
      PostCommitEffects.wake(WorkerWakeKind.OcrSubmissions)

    assertEquals(
      effects,
      PostCommitEffects.wakeAll(WorkerWakeKind.ProcessingJobs, WorkerWakeKind.OcrSubmissions),
    )
    assert(PostCommitEffects.empty.isEmpty)
    assert(!effects.isEmpty)
