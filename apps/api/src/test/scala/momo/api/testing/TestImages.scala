package momo.api.testing

object TestImages:
  def png1x1: Array[Byte] = png(width = 1, height = 1)

  def png(width: Int, height: Int): Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ++ bigEndian32(13) ++
      Array('I', 'H', 'D', 'R').map(_.toByte) ++ bigEndian32(width) ++ bigEndian32(height) ++
      Array[Byte](8, 2, 0, 0, 0) ++ Array.fill[Byte](4)(0.toByte)

  def jpeg(width: Int, height: Int): Array[Byte] =
    Array[Byte](0xff.toByte, 0xd8.toByte, 0xff.toByte, 0xc0.toByte) ++ bigEndian16(17) ++
      Array[Byte](8) ++ bigEndian16(height) ++ bigEndian16(width) ++
      Array.fill[Byte](10)(0.toByte) ++ Array[Byte](0xff.toByte, 0xd9.toByte)

  def webp(width: Int, height: Int): Array[Byte] = Array('R', 'I', 'F', 'F')
    .map(_.toByte) ++ littleEndian32(22) ++ Array('W', 'E', 'B', 'P').map(_.toByte) ++
    Array('V', 'P', '8', 'X').map(_.toByte) ++ littleEndian32(10) ++
    Array.fill[Byte](4)(0.toByte) ++ littleEndian24(width - 1) ++ littleEndian24(height - 1)

  private def bigEndian16(value: Int): Array[Byte] =
    Array(((value >> 8) & 0xff).toByte, (value & 0xff).toByte)

  private def bigEndian32(value: Int): Array[Byte] = Array(
    ((value >> 24) & 0xff).toByte,
    ((value >> 16) & 0xff).toByte,
    ((value >> 8) & 0xff).toByte,
    (value & 0xff).toByte,
  )

  private def littleEndian24(value: Int): Array[Byte] =
    Array((value & 0xff).toByte, ((value >> 8) & 0xff).toByte, ((value >> 16) & 0xff).toByte)

  private def littleEndian32(value: Int): Array[Byte] = Array(
    (value & 0xff).toByte,
    ((value >> 8) & 0xff).toByte,
    ((value >> 16) & 0xff).toByte,
    ((value >> 24) & 0xff).toByte,
  )
