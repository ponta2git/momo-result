package momo.api.adapters.storage.local

import java.nio.file.{
  AccessDeniedException,
  FileAlreadyExistsException,
  Files,
  LinkOption,
  NoSuchFileException,
  Path,
  StandardOpenOption
}

import scala.jdk.CollectionConverters.*

import cats.effect.Async
import cats.syntax.all.*

import momo.api.adapters.storage.ImageValidation
import momo.api.ports.storage.{
  ImageDiskUsage,
  Sha256Hex,
  SourceImageObject,
  SourceImageObjectFailure,
  SourceImageObjectKey,
  SourceImageObjectMetadata,
  SourceImageObjectStorage
}

/**
 * Filesystem implementation of the opaque object-storage contract for local Postgres runtimes.
 *
 * The database remains the source of truth for image lifecycle and integrity metadata. Files are
 * addressed only by validated relative object keys, matching the R2-backed production contract.
 */
final class LocalSourceImageObjectStorage[F[_]: Async](root: Path)
    extends SourceImageObjectStorage[F]:
  import LocalSourceImageObjectStorage.*

  private val rootDirectory = root.toAbsolutePath.normalize()

  override def put(
      key: SourceImageObjectKey,
      mediaType: String,
      bytes: Array[Byte],
      sha256: Sha256Hex,
  ): F[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] =
    expectedMetadata(key, mediaType, bytes, sha256) match
      case Left(failure) => Async[F].pure(Left(failure))
      case Right(expected) => run {
          pathFor(key).flatMap { path =>
            ancestorsAvailable(path, create = true).flatMap {
              case false => Left(SourceImageObjectFailure.Unavailable)
              case true if Files.exists(path, LinkOption.NOFOLLOW_LINKS) =>
                readObject(key, path).flatMap(existing =>
                  Either.cond(
                    existing.metadata == expected,
                    existing.metadata,
                    SourceImageObjectFailure.IntegrityViolation,
                  )
                )
              case true =>
                try
                  writeNew(path, bytes)
                  Right(expected)
                catch
                  case _: FileAlreadyExistsException => readObject(key, path).flatMap(existing =>
                      Either.cond(
                        existing.metadata == expected,
                        existing.metadata,
                        SourceImageObjectFailure.IntegrityViolation,
                      )
                    )
            }
          }
        }

  override def head(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] = run {
    pathFor(key).flatMap(path => readObject(key, path).map(_.metadata))
  }

  override def get(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, SourceImageObject]] = run {
    pathFor(key).flatMap(path => readObject(key, path))
  }

  override def delete(
      key: SourceImageObjectKey
  ): F[Either[SourceImageObjectFailure, Unit]] = run {
    pathFor(key).flatMap { path =>
      ancestorsAvailable(path, create = false).flatMap {
        case false => Right(())
        case true if Files.isSymbolicLink(path) =>
          Left(SourceImageObjectFailure.IntegrityViolation)
        case true =>
          val _ = Files.deleteIfExists(path)
          Right(())
      }
    }
  }

  private[momo] def diskUsage: F[Option[ImageDiskUsage]] = Async[F]
    .blocking(directoryAvailable(rootDirectory, create = true, createParents = true)).flatMap {
      case Right(true) => Async[F].blocking(Some(ImageDiskUsage(
          totalBytes = rootDirectory.toFile.getTotalSpace,
          usableBytes = rootDirectory.toFile.getUsableSpace,
        )))
      case Left(_) | Right(false) => Async[F].raiseError(
          new IllegalStateException("Local image object root is unavailable.")
        )
    }

  private def pathFor(
      key: SourceImageObjectKey
  ): Either[SourceImageObjectFailure, Path] =
    val path = rootDirectory.resolve(key.value).normalize()
    Either.cond(
      path.startsWith(rootDirectory) && !path.equals(rootDirectory),
      path,
      SourceImageObjectFailure.IntegrityViolation,
    )

  private def readObject(
      key: SourceImageObjectKey,
      path: Path,
  ): Either[SourceImageObjectFailure, SourceImageObject] = ancestorsAvailable(
    path,
    create = false,
  ).flatMap {
    case false => Left(SourceImageObjectFailure.NotFound)
    case true => LocalSourceImageObjectStorage.readObject(key, path)
  }

  private def ancestorsAvailable(
      path: Path,
      create: Boolean,
  ): Either[SourceImageObjectFailure, Boolean] =
    val descendants = rootDirectory.relativize(path.getParent).iterator().asScala.toList
      .scanLeft(rootDirectory)((parent, segment) => parent.resolve(segment))
    descendants.zipWithIndex.foldLeft[Either[SourceImageObjectFailure, Boolean]](Right(true)) {
      case (failure @ Left(_), _) => failure
      case (Right(false), _) => Right(false)
      case (Right(true), (directory, index)) =>
        directoryAvailable(directory, create, createParents = index == 0)
    }

  private def directoryAvailable(
      path: Path,
      create: Boolean,
      createParents: Boolean,
  ): Either[SourceImageObjectFailure, Boolean] =
    if Files.exists(path, LinkOption.NOFOLLOW_LINKS) then safeDirectory(path)
    else if !create then Right(false)
    else
      try
        if createParents then Files.createDirectories(path)
        else Files.createDirectory(path)
      catch case _: FileAlreadyExistsException => ()
      safeDirectory(path)

  private def safeDirectory(path: Path): Either[SourceImageObjectFailure, Boolean] = Either.cond(
    !Files.isSymbolicLink(path) && Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS),
    true,
    SourceImageObjectFailure.AccessDenied,
  )

  private def run[A](
      operation: => Either[SourceImageObjectFailure, A]
  ): F[Either[SourceImageObjectFailure, A]] = Async[F].blocking(operation)
    .handleError(error => Left(failureFor(error)))

object LocalSourceImageObjectStorage:
  private def expectedMetadata(
      key: SourceImageObjectKey,
      mediaType: String,
      bytes: Array[Byte],
      expectedSha256: Sha256Hex,
  ): Either[SourceImageObjectFailure, SourceImageObjectMetadata] =
    metadataFor(key, bytes).flatMap { metadata =>
      Either.cond(
        metadata.mediaType == ImageValidation.normalizeMediaType(mediaType) &&
          metadata.sha256 == expectedSha256,
        metadata,
        SourceImageObjectFailure.IntegrityViolation,
      )
    }

  private[local] def readObject(
      key: SourceImageObjectKey,
      path: Path,
  ): Either[SourceImageObjectFailure, SourceImageObject] =
    if !Files.exists(path, LinkOption.NOFOLLOW_LINKS) then
      Left(SourceImageObjectFailure.NotFound)
    else if Files.isSymbolicLink(path) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) then
      Left(SourceImageObjectFailure.IntegrityViolation)
    else
      val bytes = readBounded(path)
      metadataFor(key, bytes).map(SourceImageObject(_, bytes))

  private def metadataFor(
      key: SourceImageObjectKey,
      bytes: Array[Byte],
  ): Either[SourceImageObjectFailure, SourceImageObjectMetadata] =
    ImageValidation.validate(bytes, contentType = None).leftMap(_ =>
      SourceImageObjectFailure.IntegrityViolation
    ).flatMap { validated =>
      Either.cond(
        key.value.endsWith(s".${validated.imageType.extension}"),
        SourceImageObjectMetadata(
          key = key,
          mediaType = validated.imageType.mediaType,
          sizeBytes = bytes.length.toLong,
          sha256 = Sha256Hex.digest(bytes),
          etag = None,
        ),
        SourceImageObjectFailure.IntegrityViolation,
      )
    }

  private def readBounded(path: Path): Array[Byte] =
    val input = Files.newInputStream(path, StandardOpenOption.READ)
    try input.readNBytes(ImageValidation.MaxBytes + 1)
    finally input.close()

  private def writeNew(path: Path, bytes: Array[Byte]): Unit =
    val temporary = Files.createTempFile(path.getParent, ".momo-source-image-", ".tmp")
    try
      val _ = Files.write(
        temporary,
        bytes,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE,
      )
      // Publishing with a hard link is atomic and refuses to replace an existing immutable key.
      val _ = Files.createLink(path, temporary)
    finally
      val _ = Files.deleteIfExists(temporary)

  private def failureFor(error: Throwable): SourceImageObjectFailure = error match
    case _: NoSuchFileException => SourceImageObjectFailure.NotFound
    case _: AccessDeniedException | _: SecurityException => SourceImageObjectFailure.AccessDenied
    case _ => SourceImageObjectFailure.Unavailable
