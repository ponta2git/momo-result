package momo.api.adapters.postgres

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.syntax.all.*
import munit.CatsEffectSuite

import momo.api.config.SeriesAnalysisReadConfig
import momo.api.domain.SeriesAnalysisChunk
import momo.api.errors.AppError

final class PostgresSeriesAnalysisReadBoundSpec extends CatsEffectSuite:
  test("timed out reads return a retryable error and release the decode permit"):
    val config = SeriesAnalysisReadConfig.defaults.copy(
      readTimeout = scala.concurrent.duration.DurationInt(1).millis
    )
    for
      semaphore <- Semaphore[IO](1)
      timedOut <- PostgresSeriesAnalysisRepository.boundedChunkRead(semaphore, config)(
        IO.never[Either[AppError, SeriesAnalysisChunk]]
      )
      permitAfterTimeout <- semaphore.tryAcquire
      _ <- semaphore.release.whenA(permitAfterTimeout)
    yield
      assertEquals(
        timedOut,
        Left(AppError.AnalysisReadBusy(config.busyRetryAfterSeconds)),
      )
      assertEquals(permitAfterTimeout, true)

  test("a saturated decode semaphore fails without starting the read"):
    val config = SeriesAnalysisReadConfig.defaults
    for
      semaphore <- Semaphore[IO](0)
      started <- cats.effect.Ref.of[IO, Boolean](false)
      result <- PostgresSeriesAnalysisRepository.boundedChunkRead(semaphore, config)(
        started.set(true) *> IO.raiseError[Either[AppError, SeriesAnalysisChunk]](
          new IllegalStateException("saturated reads must not start")
        )
      )
      wasStarted <- started.get
    yield
      assertEquals(
        result,
        Left(AppError.AnalysisReadBusy(config.busyRetryAfterSeconds)),
      )
      assertEquals(wasStarted, false)
end PostgresSeriesAnalysisReadBoundSpec
