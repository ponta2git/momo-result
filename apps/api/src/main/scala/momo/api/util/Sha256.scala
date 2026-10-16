package momo.api.util

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Byte encoding only; callers retain their own identity and fingerprint contracts. */
object Sha256:
  def hex(bytes: Array[Byte]): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).map(byte => f"${byte & 0xff}%02x").mkString

  def hexUtf8(value: String): String = hex(value.getBytes(StandardCharsets.UTF_8))
