package momo.api

import cats.effect.{Deferred, IO}

final class MainSpec extends MomoCatsEffectSuite:
  test("the server lifetime fails when a supervised runtime boundary reports failure"):
    val expected = new IllegalStateException("background runtime stopped")
    for
      signal <- Deferred[IO, Throwable]
      waiting <- Main.awaitRuntimeFailure(signal.get.flatMap(IO.raiseError[Nothing])).start
      _ <- signal.complete(expected)
      actual <- waiting.joinWithNever.attempt
    yield assertEquals(actual, Left(expected))

end MainSpec
