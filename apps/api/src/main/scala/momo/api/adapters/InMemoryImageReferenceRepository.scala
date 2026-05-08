package momo.api.adapters

import cats.Applicative

import momo.api.domain.ids.ImageId
import momo.api.repositories.ImageReferenceRepository

final class InMemoryImageReferenceRepository[F[_]: Applicative] extends ImageReferenceRepository[F]:
  override def referencedImageIds: F[Set[ImageId]] = Applicative[F].pure(Set.empty)
