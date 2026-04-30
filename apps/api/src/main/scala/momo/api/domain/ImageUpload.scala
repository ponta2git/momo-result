package momo.api.domain

import java.nio.file.Path
import momo.api.domain.ids.*

final case class StoredImage(imageId: ImageId, path: Path, mediaType: String, sizeBytes: Long)
