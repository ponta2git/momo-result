package momo.api.usecases.maintenance

import java.time.Instant

import scala.concurrent.duration.*

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.ImageId
import momo.api.ports.storage.ReferenceAwareImageOrphanCleaner
import momo.api.repositories.ImageReferenceRepository

final class SourceImageOrphanReaperSpec extends MomoCatsEffectSuite:
  test("standalone filesystem adapter resolves references once at sweep time"):
    val referenced = Set(ImageId.unsafeFromString("source-kept"))
    val threshold = Instant.parse("2026-08-14T00:00:00Z")
    for
      referenceCalls <- Ref.of[IO, Int](0)
      observed <- Ref.of[IO, Option[(Set[ImageId], Instant)]](None)
      references = new ImageReferenceRepository[IO]:
        override def referencedImageIds: IO[Set[ImageId]] =
          referenceCalls.update(_ + 1).as(referenced)
      cleaner = new ReferenceAwareImageOrphanCleaner[IO]:
        override def deleteOrphans(ids: Set[ImageId], olderThan: Instant): IO[Int] =
          observed.set(Some(ids -> olderThan)).as(1)
      adapted = SourceImageOrphanReaper.referenceAwareCleaner(
        cleaner,
        references,
        15.minutes,
        IO.pure(threshold.plusSeconds(15.minutes.toSeconds)),
      )
      deleted <- adapted.runOnce
      calls <- referenceCalls.get
      actual <- observed.get
    yield
      assertEquals(deleted, 1)
      assertEquals(calls, 1)
      assertEquals(actual, Some(referenced -> threshold))
