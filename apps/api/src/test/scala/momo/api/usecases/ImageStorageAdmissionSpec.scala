package momo.api.usecases

import cats.effect.IO
import org.typelevel.log4cats.LoggerFactory
import org.typelevel.log4cats.noop.NoOpFactory

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.errors.AppError
import momo.api.repositories.{
  ImageDiskUsage, ImageReferenceRepository, ImageStorageInspector, ImageStorageUsage,
}

final class ImageStorageAdmissionSpec extends MomoCatsEffectSuite:
  private given LoggerFactory[IO] = NoOpFactory[IO]

  private val accountId = AccountId.unsafeFromString("account-1")
  private val config = ImageStorageAdmission.Config(
    unreferencedCountLimit = 2,
    unreferencedBytesLimit = 100,
    storageMinFreeBytes = 10,
    storageMaxUsedPercent = 90,
  )

  test("allows uploads when account quota and disk waterline stay within limits") {
    val admission = ImageStorageAdmission.from[IO](
      inspector = FixedInspector(
        usage = IO.pure(ImageStorageUsage(fileCount = 1, sizeBytes = 20)),
        disk = IO.pure(ImageDiskUsage(totalBytes = 1000, usableBytes = 500)),
      ),
      references = FixedReferences(IO.pure(Set.empty)),
      config = config,
    )

    admission.ensureCanAccept(accountId, incomingBytes = 10).map { result =>
      assertEquals(result, Right(()))
    }
  }

  test("rejects uploads that exceed the unreferenced image count quota") {
    val admission = ImageStorageAdmission.from[IO](
      inspector = FixedInspector(
        usage = IO.pure(ImageStorageUsage(fileCount = 2, sizeBytes = 20)),
        disk = IO.pure(ImageDiskUsage(totalBytes = 1000, usableBytes = 500)),
      ),
      references = FixedReferences(IO.pure(Set.empty)),
      config = config,
    )

    admission.ensureCanAccept(accountId, incomingBytes = 10).map {
      case Left(error: AppError.TooManyRequests) => assert(error.detail.contains("unprocessed"))
      case other => fail(s"expected TooManyRequests, got $other")
    }
  }

  test("rejects uploads that exceed the unreferenced image byte quota") {
    val admission = ImageStorageAdmission.from[IO](
      inspector = FixedInspector(
        usage = IO.pure(ImageStorageUsage(fileCount = 1, sizeBytes = 95)),
        disk = IO.pure(ImageDiskUsage(totalBytes = 1000, usableBytes = 500)),
      ),
      references = FixedReferences(IO.pure(Set.empty)),
      config = config,
    )

    admission.ensureCanAccept(accountId, incomingBytes = 10).map {
      case Left(error: AppError.TooManyRequests) => assert(error.detail.contains("unprocessed"))
      case other => fail(s"expected TooManyRequests, got $other")
    }
  }

  test("rejects uploads when disk free reserve would be crossed") {
    val admission = ImageStorageAdmission.from[IO](
      inspector = FixedInspector(
        usage = IO.pure(ImageStorageUsage(fileCount = 0, sizeBytes = 0)),
        disk = IO.pure(ImageDiskUsage(totalBytes = 1000, usableBytes = 15)),
      ),
      references = FixedReferences(IO.pure(Set.empty)),
      config = config,
    )

    admission.ensureCanAccept(accountId, incomingBytes = 10).map {
      case Left(error: AppError.ServiceUnavailable) => assert(error.detail.contains("storage"))
      case other => fail(s"expected ServiceUnavailable, got $other")
    }
  }

  test("fails closed when referenced image status cannot be read") {
    val admission = ImageStorageAdmission.from[IO](
      inspector = FixedInspector(
        usage = IO.pure(ImageStorageUsage(fileCount = 0, sizeBytes = 0)),
        disk = IO.pure(ImageDiskUsage(totalBytes = 1000, usableBytes = 500)),
      ),
      references = FixedReferences(IO.raiseError(new RuntimeException("boom"))),
      config = config,
    )

    admission.ensureCanAccept(accountId, incomingBytes = 10).map {
      case Left(error: AppError.ServiceUnavailable) => assert(error.detail.contains("storage"))
      case other => fail(s"expected ServiceUnavailable, got $other")
    }
  }

  private final case class FixedInspector(
      usage: IO[ImageStorageUsage],
      disk: IO[ImageDiskUsage],
  ) extends ImageStorageInspector[IO]:
    override def unreferencedUsage(
        ownerAccountId: AccountId,
        referenced: Set[ImageId],
    ): IO[ImageStorageUsage] =
      val _ = (ownerAccountId, referenced)
      usage
    override def diskUsage: IO[ImageDiskUsage] = disk

  private final case class FixedReferences(result: IO[Set[ImageId]])
      extends ImageReferenceRepository[IO]:
    override def referencedImageIds: IO[Set[ImageId]] = result
