package momo.api.testing

object TestImages:
  def png1x1: Array[Byte] = png(width = 1, height = 1)

  def png(width: Int, height: Int): Array[Byte] =
    Array[Byte](0x89.toByte, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ++
      pngChunk("IHDR", bigEndian32(width) ++ bigEndian32(height) ++ Array[Byte](8, 2, 0, 0, 0)) ++
      pngChunk("IDAT", Array[Byte](0)) ++ pngChunk("IEND", Array.emptyByteArray)

  def jpeg(width: Int, height: Int): Array[Byte] =
    Array[Byte](0xff.toByte, 0xd8.toByte, 0xff.toByte, 0xc0.toByte) ++ bigEndian16(17) ++
      Array[Byte](8) ++ bigEndian16(height) ++ bigEndian16(width) ++
      Array.fill[Byte](10)(0.toByte) ++ Array[Byte](0xff.toByte, 0xda.toByte) ++ bigEndian16(8) ++
      Array.fill[Byte](6)(0.toByte) ++ Array[Byte](0, 0xff.toByte, 0xd9.toByte)

  def webp(width: Int, height: Int): Array[Byte] =
    val payload = Array[Byte](0x2f) ++ littleEndian32(losslessDimensionBits(width, height))
    val chunk = Array('V', 'P', '8', 'L').map(_.toByte) ++ littleEndian32(payload.length) ++
      payload ++ Array.fill[Byte](payload.length % 2)(0.toByte)
    Array('R', 'I', 'F', 'F').map(_.toByte) ++ littleEndian32(4 + chunk.length) ++
      Array('W', 'E', 'B', 'P').map(_.toByte) ++ chunk

  private def pngChunk(kind: String, data: Array[Byte]): Array[Byte] = bigEndian32(data.length) ++
    kind.toCharArray.map(_.toByte) ++ data ++ Array.fill[Byte](4)(0.toByte)

  private def losslessDimensionBits(width: Int, height: Int): Int =
    (width - 1) | ((height - 1) << 14)

  private def bigEndian16(value: Int): Array[Byte] =
    Array(((value >> 8) & 0xff).toByte, (value & 0xff).toByte)

  private def bigEndian32(value: Int): Array[Byte] = Array(
    ((value >> 24) & 0xff).toByte,
    ((value >> 16) & 0xff).toByte,
    ((value >> 8) & 0xff).toByte,
    (value & 0xff).toByte,
  )

  private def littleEndian32(value: Int): Array[Byte] = Array(
    (value & 0xff).toByte,
    ((value >> 8) & 0xff).toByte,
    ((value >> 16) & 0xff).toByte,
    ((value >> 24) & 0xff).toByte,
  )
