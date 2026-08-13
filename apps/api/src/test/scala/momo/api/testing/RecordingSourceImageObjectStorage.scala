package momo.api.testing

import cats.effect.{IO, Ref}

import momo.api.ports.storage.*

final class RecordingSourceImageObjectStorage private (
    ref: Ref[IO, RecordingSourceImageObjectStorage.State]
) extends SourceImageObjectStorage[IO]:
  override def put(
      key: SourceImageObjectKey,
      mediaType: String,
      bytes: Array[Byte],
      sha256: Sha256Hex,
  ): IO[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] = ref.modify { state =>
    val next = state.copy(putCount = state.putCount + 1, nextPutFailure = None)
    state.nextPutFailure match
      case Some(failure) => next -> Left(failure)
      case None =>
        val metadata = SourceImageObjectMetadata(
          key,
          mediaType,
          bytes.length.toLong,
          sha256,
          Some("etag-recording"),
        )
        next.copy(objects = next.objects.updated(key, SourceImageObject(metadata, bytes))) ->
          Right(metadata)
  }

  override def head(
      key: SourceImageObjectKey
  ): IO[Either[SourceImageObjectFailure, SourceImageObjectMetadata]] = get(key)
    .map(_.map(_.metadata))

  override def get(
      key: SourceImageObjectKey
  ): IO[Either[SourceImageObjectFailure, SourceImageObject]] = ref.modify { state =>
    val next = state.copy(nextGetFailure = None)
    state.nextGetFailure match
      case Some(failure) => next -> Left(failure)
      case None => next -> state.objects.get(key).toRight(SourceImageObjectFailure.NotFound)
  }

  override def delete(
      key: SourceImageObjectKey
  ): IO[Either[SourceImageObjectFailure, Unit]] =
    ref.modify(state => state.copy(objects = state.objects.removed(key)) -> Right(()))

  def failNextPut(failure: SourceImageObjectFailure): IO[Unit] = ref.update(
    _.copy(nextPutFailure = Some(failure))
  )

  def failNextGet(failure: SourceImageObjectFailure): IO[Unit] = ref.update(
    _.copy(nextGetFailure = Some(failure))
  )

  def putCount: IO[Int] = ref.get.map(_.putCount)

  def contains(key: SourceImageObjectKey): IO[Boolean] = ref.get.map(_.objects.contains(key))

  def tamper(rawKey: String, bytes: Array[Byte]): IO[Unit] = SourceImageObjectKey
    .fromString(rawKey).fold(
      message => IO.raiseError(new IllegalArgumentException(message)),
      key =>
        ref.update(state =>
          state.copy(objects = state.objects.updatedWith(key)(_.map(_.copy(bytes = bytes))))
        ),
    )

object RecordingSourceImageObjectStorage:
  private final case class State(
      objects: Map[SourceImageObjectKey, SourceImageObject],
      putCount: Int,
      nextPutFailure: Option[SourceImageObjectFailure],
      nextGetFailure: Option[SourceImageObjectFailure],
  )

  def create: IO[RecordingSourceImageObjectStorage] = Ref.of[IO, State](State(
    objects = Map.empty,
    putCount = 0,
    nextPutFailure = None,
    nextGetFailure = None,
  )).map(new RecordingSourceImageObjectStorage(_))
