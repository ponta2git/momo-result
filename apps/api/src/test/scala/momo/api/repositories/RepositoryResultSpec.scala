package momo.api.repositories

import cats.effect.IO

import momo.api.MomoCatsEffectSuite
import momo.api.errors.{AppError, AppException}

final class RepositoryResultSpec extends MomoCatsEffectSuite:
  test("represents expected application rejections as values"):
    val expected = AppError.Conflict("write rejected")

    RepositoryResult.capture[IO, Unit](IO.raiseError(AppException(expected))).map { result =>
      assertEquals(result, Left(expected))
    }

  test("keeps unexpected failures on the throwable channel"):
    val failure = new IllegalStateException("storage unavailable")

    RepositoryResult.capture[IO, Unit](IO.raiseError(failure)).attempt.map { result =>
      assertEquals(result, Left(failure))
    }
end RepositoryResultSpec
