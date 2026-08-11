package momo.api.adapters.storage.local

import java.nio.file.{Files, LinkOption, Path, StandardOpenOption}
import java.time.Instant

import scala.jdk.CollectionConverters.*

import cats.effect.std.Random
import cats.effect.{Async, Sync}
import cats.syntax.all.*
import fs2.Stream
import fs2.io.file.{Files as Fs2Files, Path as Fs2Path}

import momo.api.adapters.storage.ImageValidation
import momo.api.domain.ids.*
import momo.api.domain.{StoredImage, StoredImageLocation}
import momo.api.errors.AppError
import momo.api.ports.storage.{
  ImageDiskUsage,
  ImageOrphanCleaner,
  ImageStorage,
  ImageStorageInspector,
  ImageStorageUsage
}

final class LocalFsImageStore[F[_]: Async: Random](root: Path)
    extends ImageStorage[F], ImageStorageInspector[F], ImageOrphanCleaner[F]:
  import ImageValidation.*
  import LocalFsImageStoreSupport.*

  private val rootDirectory: Path = root.toAbsolutePath.normalize()

  override def save(
      ownerAccountId: AccountId,
      fileName: Option[String],
      contentType: Option[String],
      bytes: Array[Byte],
  ): F[Either[AppError, StoredImage]] = validate(bytes, contentType).traverse { validated =>
    for
      id <- ImageId.fresh[F]
      directory = accountDirectory(ownerAccountId)
      _ <- Sync[F].blocking(Files.createDirectories(directory))
      imageType = validated.imageType
      path = directory.resolve(s"${id.value}.${imageType.extension}").toAbsolutePath.normalize()
      _ <- Sync[F]
        .blocking(Files.write(path, bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE))
    yield StoredImage(id, locationFor(path), imageType.mediaType, bytes.length.toLong)
  }

  override def find(imageId: ImageId): F[Option[StoredImage]] = Sync[F].blocking {
    imagePaths(imageId).headOption.map { case (path, imageType) =>
      StoredImage(imageId, locationFor(path), imageType.mediaType, Files.size(path))
    }
  }

  override def readStream(image: StoredImage): Stream[F, Byte] = Fs2Files.forAsync[F]
    .readAll(Fs2Path.fromNioPath(pathFor(image.location)))

  override def delete(imageId: ImageId): F[Boolean] = Sync[F].blocking {
    imagePaths(imageId)
      .foldLeft(false)((deleted, pathAndType) => Files.deleteIfExists(pathAndType._1) || deleted)
  }

  override def unreferencedUsage(
      ownerAccountId: AccountId,
      referenced: Set[ImageId],
  ): F[ImageStorageUsage] = Sync[F].blocking {
    val directory = accountDirectory(ownerAccountId)
    if !Files.isDirectory(directory) then ImageStorageUsage(fileCount = 0, sizeBytes = 0L)
    else
      imageFiles(directory).filterNot(path => fileImageId(path).exists(referenced.contains))
        .foldLeft(ImageStorageUsage(fileCount = 0, sizeBytes = 0L)) { (usage, path) =>
          usage
            .copy(fileCount = usage.fileCount + 1, sizeBytes = usage.sizeBytes + Files.size(path))
        }
  }

  override def diskUsage: F[ImageDiskUsage] = Sync[F].blocking {
    Files.createDirectories(rootDirectory)
    ImageDiskUsage(
      totalBytes = rootDirectory.toFile.getTotalSpace,
      usableBytes = rootDirectory.toFile.getUsableSpace,
    )
  }

  override def deleteOrphans(referenced: Set[ImageId], olderThan: Instant): F[Int] = Sync[F]
    .blocking {
      if !Files.isDirectory(rootDirectory) then 0
      else
        val deleted = imageFiles(rootDirectory).count { path =>
          fileImageId(path).exists(id => !referenced.contains(id)) &&
          Files.getLastModifiedTime(path).toInstant.isBefore(olderThan) &&
          Files.deleteIfExists(path)
        }
        deleteEmptyDirectories()
        deleted
    }

  private def accountDirectory(accountId: AccountId): Path = rootDirectory
    .resolve(s"account-${sha256Hex(accountId.value)}").normalize()

  private def flatImagePath(stem: String, imageType: ImageType): Path = rootDirectory
    .resolve(s"$stem.${imageType.extension}").normalize()

  private def imagePaths(imageId: ImageId): List[(Path, ImageType)] =
    val stem = safeImageFileStem(imageId)
    val candidates = stem.toList.flatMap(value =>
      SupportedImageTypes.map(imageType => flatImagePath(value, imageType) -> imageType)
    )
    val nested = stem match
      case None => List.empty[(Path, ImageType)]
      case Some(value) if !Files.isDirectory(rootDirectory) => List.empty[(Path, ImageType)]
      case Some(value) => imageFiles(rootDirectory).flatMap(path =>
          SupportedImageTypes.collectFirst {
            case imageType if path.getFileName.toString == s"$value.${imageType.extension}" =>
              path -> imageType
          }
        )
    (candidates ++ nested).distinct.filter(pathAndType => Files.exists(pathAndType._1))

  private def imageFiles(directory: Path): List[Path] =
    val paths = Files.walk(directory, 2)
    try paths.iterator().asScala.toList
        .filter(path => Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
        .filter(path => fileImageId(path).isDefined)
    finally paths.close()

  private def deleteEmptyDirectories(): Unit =
    val paths = Files.walk(rootDirectory, 2)
    try paths.iterator().asScala.toList.sortBy(_.getNameCount).reverseIterator.foreach { path =>
        if !path.equals(rootDirectory) && Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) then
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

  private def locationFor(path: Path): StoredImageLocation = StoredImageLocation
    .unsafeFromString(path.toAbsolutePath.normalize().toString)

  private def pathFor(location: StoredImageLocation): Path = Path.of(location.value)

object LocalFsImageStore:
  val MaxBytes: Int = ImageValidation.MaxBytes
  val MaxWidth: Int = ImageValidation.MaxWidth
  val MaxHeight: Int = ImageValidation.MaxHeight
  val MaxDimensionsLabel: String = ImageValidation.MaxDimensionsLabel

  def normalizeMediaType(value: String): String = ImageValidation.normalizeMediaType(value)

  def detect(bytes: Array[Byte]): Option[ImageValidation.ImageType] = ImageValidation.detect(bytes)
