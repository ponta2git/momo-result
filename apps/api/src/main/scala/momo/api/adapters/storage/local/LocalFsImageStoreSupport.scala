package momo.api.adapters.storage.local

import momo.api.domain.ids.ImageId
import momo.api.util.Sha256

private[storage] object LocalFsImageStoreSupport:
  private[adapters] def sha256Hex(value: String): String = Sha256.hexUtf8(value)

  private[adapters] def safeImageFileStem(imageId: ImageId): Option[String] = Option
    .when(isSafeImageFileStem(imageId.value))(imageId.value)

  private[adapters] def isSafeImageFileStem(value: String): Boolean = value.nonEmpty &&
    value
      .forall(character => isAsciiLetterOrDigit(character) || character == '-' || character == '_')

  private def isAsciiLetterOrDigit(character: Char): Boolean =
    (character >= 'A' && character <= 'Z') ||
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9')
