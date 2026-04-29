package momo.api.domain

import momo.api.domain.ids.*

import java.nio.file.Path

final case class StoredImage(
    imageId: ImageId,
    path: Path,
    mediaType: String,
    sizeBytes: Long
)
