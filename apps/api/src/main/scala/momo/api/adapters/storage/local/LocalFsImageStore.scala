package momo.api.adapters.storage.local

import java.nio.file.{Files, LinkOption, Path}
import java.time.Instant

import scala.jdk.CollectionConverters.*

import cats.effect.Async
import cats.effect.std.Random
import cats.syntax.all.*
import fs2.Stream

import momo.api.adapters.storage.ImageValidation
import momo.api.domain.ids.*
import momo.api.domain.{StoredImage, StoredImageLocation}
import momo.api.errors.{AppError, AppException}
import momo.api.ports.storage.*

/** Standalone image lifecycle over the same bounded, immutable object I/O as the DB runtime. */
final class LocalFsImageStore[F[_]: Async: Random](root: Path)
    extends ImageStorage[F], ImageStorageInspector[F], ReferenceAwareImageOrphanCleaner[F]:
  import ImageValidation.*
  import LocalFsImageStoreSupport.*

  private val rootDirectory = root.toAbsolutePath.normalize()
  private val objects = LocalSourceImageObjectStorage[F](rootDirectory)

  override def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = Async[F].delay(validate(bytes, contentType)).flatMap {
    _.traverse { validated =>
      for
        id <- ImageId.fresh[F]
        path =
          accountDirectory(ownerAccountId).resolve(s"${id.value}.${validated.imageType.extension}")
        key <- keyFor(path).liftTo[F]
        digest <- Async[F].delay(Sha256Hex.digest(bytes))
        metadata <- objects.put(key, validated.imageType.mediaType, bytes, digest)
          .flatMap(_.leftMap(storageError).liftTo[F])
      yield storedImage(id, path, metadata)
    }
  }

  override def find(imageId: ImageId): F[Option[StoredImage]] = Async[F]
    .blocking(imagePaths(imageId).headOption).flatMap(_.traverse { path =>
      keyFor(path).liftTo[F].flatMap(objects.head).flatMap(_.leftMap(storageError).liftTo[F])
        .map(storedImage(imageId, path, _))
    })

  override def readStream(image: StoredImage): Stream[F, Byte] = Stream.eval {
    Async[F].delay(Path.of(image.location.value)).flatMap(path => keyFor(path).liftTo[F])
      .flatMap(objects.get).flatMap(_.leftMap(storageError).liftTo[F]).flatMap { stored =>
        val metadata = stored.metadata
        if metadata.mediaType == image.mediaType && metadata.sizeBytes == image.sizeBytes &&
          metadata.sha256.value == image.sha256
        then Async[F].pure(stored.bytes)
        else
          Async[F].raiseError[Array[Byte]](storageError(
            SourceImageObjectFailure.IntegrityViolation
          ))
      }
  }.flatMap(bytes => Stream.emits(bytes).covary[F])

  override def delete(imageId: ImageId): F[Boolean] = Async[F].blocking {
    imagePaths(imageId).foldLeft(false)((deleted, path) => Files.deleteIfExists(path) || deleted)
  }

  override def unreferencedUsage(
      ownerAccountId: AccountId,
      referenced: Set[ImageId],
  ): F[ImageStorageUsage] = Async[F].blocking {
    withImageFiles(accountDirectory(ownerAccountId)) { paths =>
      paths.filterNot(path => fileImageId(path).exists(referenced.contains))
        .foldLeft(ImageStorageUsage(fileCount = 0, sizeBytes = 0L)) { (usage, path) =>
          usage.copy(
            fileCount = usage.fileCount + 1,
            sizeBytes = usage.sizeBytes + Files.size(path)
          )
        }
    }
  }

  override def diskUsage: F[Option[ImageDiskUsage]] = objects.diskUsage

  override def deleteOrphans(referenced: Set[ImageId], olderThan: Instant): F[Int] = Async[F]
    .blocking {
      val deleted = withImageFiles(rootDirectory) { paths =>
        paths.count { path =>
          fileImageId(path).exists(id => !referenced.contains(id)) &&
          Files.getLastModifiedTime(
            path,
            LinkOption.NOFOLLOW_LINKS
          ).toInstant.isBefore(olderThan) &&
          Files.deleteIfExists(path)
        }
      }
      deleteEmptyDirectories()
      deleted
    }

  private def accountDirectory(accountId: AccountId): Path = rootDirectory
    .resolve(s"account-${sha256Hex(accountId.value)}")

  private def imagePaths(imageId: ImageId): List[Path] =
    safeImageFileStem(imageId).fold(List.empty[Path]) {
      stem =>
        withImageFiles(rootDirectory) { paths =>
          paths.filter(path =>
            SupportedImageTypes.exists(imageType =>
              path.getFileName.toString == s"$stem.${imageType.extension}"
            )
          ).toList
        }
    }

  /** Consume the walk while it is open; directory size never becomes a list of all paths. */
  private def withImageFiles[A](directory: Path)(consume: Iterator[Path] => A): A =
    if !Files.isDirectory(rootDirectory, LinkOption.NOFOLLOW_LINKS) ||
      !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
    then consume(Iterator.empty)
    else
      val paths = Files.walk(directory, 2)
      try consume(paths.iterator().asScala
          .filter(path => Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
          .filter(path => fileImageId(path).isDefined))
      finally paths.close()

  private def deleteEmptyDirectories(): Unit =
    if Files.isDirectory(rootDirectory, LinkOption.NOFOLLOW_LINKS) then
      val paths = Files.list(rootDirectory)
      try paths.iterator().asScala.foreach { path =>
          if Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) then
            val entries = Files.list(path)
            try if !entries.iterator().hasNext then
                val _ = Files.deleteIfExists(path)
            finally entries.close()
        }
      finally paths.close()

  private def fileImageId(path: Path): Option[ImageId] =
    val fileName = path.getFileName.toString
    SupportedImageTypes.collectFirst {
      case imageType if fileName.endsWith(s".${imageType.extension}") =>
        fileName.stripSuffix(s".${imageType.extension}")
    }.filter(isSafeImageFileStem).flatMap(ImageId.fromString(_).toOption)

  private def keyFor(path: Path): Either[AppException, SourceImageObjectKey] =
    val normalized = path.toAbsolutePath.normalize()
    if !normalized.startsWith(rootDirectory) || normalized.equals(rootDirectory) then
      Left(storageError(SourceImageObjectFailure.IntegrityViolation))
    else
      SourceImageObjectKey.fromString(rootDirectory.relativize(normalized).toString)
        .leftMap(_ => storageError(SourceImageObjectFailure.IntegrityViolation))

  private def storedImage(
      id: ImageId,
      path: Path,
      metadata: SourceImageObjectMetadata,
  ): StoredImage = StoredImage(
    id,
    StoredImageLocation.unsafeFromString(path.toString),
    metadata.mediaType,
    metadata.sizeBytes,
    metadata.sha256.value,
  )

  private def storageError(failure: SourceImageObjectFailure): AppException =
    AppException(failure match
      case SourceImageObjectFailure.NotFound => AppError.NotFound("source image", "unavailable")
      case SourceImageObjectFailure.IntegrityViolation | SourceImageObjectFailure.AccessDenied =>
        AppError.DependencyFailed("Stored image integrity verification failed.")
      case SourceImageObjectFailure.Unavailable =>
        AppError.ServiceUnavailable("Image storage is temporarily unavailable."))
