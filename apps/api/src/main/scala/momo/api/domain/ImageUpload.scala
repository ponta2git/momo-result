package momo.api.domain

import momo.api.domain.ids.*

final case class StoredImageLocation(value: String) derives CanEqual

object StoredImageLocation:
  def fromString(value: String): Either[String, StoredImageLocation] =
    val normalized = value.trim
    Either.cond(
      normalized.nonEmpty,
      StoredImageLocation(normalized),
      "image location must not be blank"
    )

  def unsafeFromString(value: String): StoredImageLocation = fromString(value)
    .fold(error => throw new IllegalArgumentException(error), identity)

final case class StoredImage(
    imageId: ImageId,
    location: StoredImageLocation,
    mediaType: String,
    sizeBytes: Long,
)
