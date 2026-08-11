package momo.api.adapters.storage.local

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import momo.api.domain.ids.ImageId

private[storage] object LocalFsImageStoreSupport:
  private[adapters] def sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.getBytes(StandardCharsets.UTF_8)).map(byte => f"${byte & 0xff}%02x").mkString

  private[adapters] def safeImageFileStem(imageId: ImageId): Option[String] = Option
    .when(isSafeImageFileStem(imageId.value))(imageId.value)

  private[adapters] def isSafeImageFileStem(value: String): Boolean = value.nonEmpty &&
    value
      .forall(character => isAsciiLetterOrDigit(character) || character == '-' || character == '_')

  private def isAsciiLetterOrDigit(character: Char): Boolean =
    (character >= 'A' && character <= 'Z') ||
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9')
