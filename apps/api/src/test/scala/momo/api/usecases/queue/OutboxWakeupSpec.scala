package momo.api.usecases.queue

import cats.effect.IO

import momo.api.MomoCatsEffectSuite

final class OutboxWakeupSpec extends MomoCatsEffectSuite:
  test("coalesces duplicate capacity-one signals independently for each kind"):
    OutboxWakeup.resource[IO].use { wakeup =>
      for
        first <- wakeup.submit(PostCommitEffects.wake(OutboxKind.Ocr))
        duplicate <- wakeup.submit(PostCommitEffects.wake(OutboxKind.Ocr))
        both <- wakeup.submit(PostCommitEffects.wakeAll(
          OutboxKind.Ocr,
          OutboxKind.SeriesAnalysis,
        ))
        ocr <- wakeup.tryAwait(OutboxKind.Ocr)
        duplicateOcr <- wakeup.tryAwait(OutboxKind.Ocr)
        analysis <- wakeup.tryAwait(OutboxKind.SeriesAnalysis)
      yield
        assertEquals(first, OutboxWakeSubmitResult.Accepted)
        assertEquals(duplicate, OutboxWakeSubmitResult.Accepted)
        assertEquals(both, OutboxWakeSubmitResult.Accepted)
        assertEquals(ocr, Some(()))
        assertEquals(duplicateOcr, None)
        assertEquals(analysis, Some(()))
    }

  test("canceling a waiter does not consume a later signal"):
    OutboxWakeup.resource[IO].use { wakeup =>
      for
        waiter <- wakeup.await(OutboxKind.Ocr).start
        _ <- IO.cede
        _ <- waiter.cancel
        _ <- wakeup.submit(PostCommitEffects.wake(OutboxKind.Ocr))
        signal <- wakeup.tryAwait(OutboxKind.Ocr)
      yield assertEquals(signal, Some(()))
    }

  test("closed sink reports closure without failing or accepting new demand"):
    for
      wakeup <- OutboxWakeup.create[IO]
      _ <- wakeup.close
      result <- wakeup.submit(PostCommitEffects.wake(OutboxKind.SeriesAnalysis))
      signal <- wakeup.tryAwait(OutboxKind.SeriesAnalysis)
    yield
      assertEquals(result, OutboxWakeSubmitResult.Closed)
      assertEquals(signal, None)

  test("post-commit effects combine as a kind set without duplicate demand"):
    val effects = PostCommitEffects.wake(OutboxKind.Ocr) ++
      PostCommitEffects.wake(OutboxKind.Ocr) ++
      PostCommitEffects.wake(OutboxKind.SeriesAnalysis)

    assertEquals(
      effects,
      PostCommitEffects.wakeAll(OutboxKind.Ocr, OutboxKind.SeriesAnalysis),
    )
    assert(PostCommitEffects.empty.isEmpty)
    assert(!effects.isEmpty)
