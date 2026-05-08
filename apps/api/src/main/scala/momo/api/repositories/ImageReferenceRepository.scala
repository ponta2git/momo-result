package momo.api.repositories

import momo.api.domain.ids.ImageId

trait ImageReferenceRepository[F[_]]:
  def referencedImageIds: F[Set[ImageId]]
