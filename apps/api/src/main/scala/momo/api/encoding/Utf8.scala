package momo.api.encoding

import scala.annotation.tailrec

/** UTF-8 byte length with the same replacement for isolated surrogates as String.getBytes. */
object Utf8:
  def length(value: CharSequence): Long =
    @tailrec
    def loop(index: Int, bytes: Long): Long =
      if index >= value.length then bytes
      else
        val codeUnit = value.charAt(index)
        if codeUnit <= 0x7f then loop(index + 1, bytes + 1)
        else if codeUnit <= 0x7ff then loop(index + 1, bytes + 2)
        else if Character.isHighSurrogate(codeUnit) && index + 1 < value.length &&
          Character.isLowSurrogate(value.charAt(index + 1))
        then loop(index + 2, bytes + 4)
        else if Character.isSurrogate(codeUnit) then loop(index + 1, bytes + 1)
        else loop(index + 1, bytes + 3)

    loop(0, 0L)
