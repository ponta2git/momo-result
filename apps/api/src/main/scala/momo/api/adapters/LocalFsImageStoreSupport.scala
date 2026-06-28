package momo.api.adapters

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import scala.annotation.tailrec

import momo.api.domain.ids.ImageId

private[adapters] object LocalFsImageStoreSupport:
  val MaxBytes = 3 * 1024 * 1024
  val MaxWidth = 3840
  val MaxHeight = 2160
  val MaxDimensionsLabel = s"${MaxWidth.toString}x${MaxHeight.toString}"

  final case class ImageType(mediaType: String, extension: String)
  private[adapters] final case class ImageDimensions(width: Long, height: Long):
    def exceedsLimit: Boolean = width <= 0L || height <= 0L || width > MaxWidth.toLong ||
      height > MaxHeight.toLong

  val Png: ImageType = ImageType("image/png", "png")
  val Jpeg: ImageType = ImageType("image/jpeg", "jpg")
  val Webp: ImageType = ImageType("image/webp", "webp")
  val SupportedImageTypes: List[ImageType] = List(Png, Jpeg, Webp)
  private val JpegStartOfFrameMarkers: Set[Int] =
    Set(0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf)
  private val JpegStartOfScanMarker = 0xda
  private val JpegEndMarker = 0xd9

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

  def normalizeMediaType(value: String): String = value.takeWhile(_ != ';').trim.toLowerCase

  def detect(bytes: Array[Byte]): Option[ImageType] =
    if bytes.length >= 8 && bytes(0) == 0x89.toByte && bytes(1) == 0x50.toByte &&
      bytes(2) == 0x4e.toByte && bytes(3) == 0x47.toByte && bytes(4) == 0x0d.toByte &&
      bytes(5) == 0x0a.toByte && bytes(6) == 0x1a.toByte && bytes(7) == 0x0a.toByte
    then Some(Png)
    else if bytes.length >= 3 && bytes(0) == 0xff.toByte && bytes(1) == 0xd8.toByte &&
      bytes(2) == 0xff.toByte
    then Some(Jpeg)
    else if bytes.length >= 12 && bytes(0) == 'R'.toByte && bytes(1) == 'I'.toByte &&
      bytes(2) == 'F'.toByte && bytes(3) == 'F'.toByte && bytes(8) == 'W'.toByte &&
      bytes(9) == 'E'.toByte && bytes(10) == 'B'.toByte && bytes(11) == 'P'.toByte
    then Some(Webp)
    else None

  private[adapters] def dimensions(bytes: Array[Byte], imageType: ImageType): Option[ImageDimensions] =
    if imageType.mediaType == Png.mediaType then pngDimensions(bytes)
    else if imageType.mediaType == Jpeg.mediaType then jpegDimensions(bytes)
    else webpDimensions(bytes)

  private def pngDimensions(bytes: Array[Byte]): Option[ImageDimensions] = Option.when(
    bytes.length >= 33 && bigEndian32(bytes, 8) == 13L &&
      matches(bytes, 12, Array('I', 'H', 'D', 'R').map(_.toByte))
  )(ImageDimensions(bigEndian32(bytes, 16), bigEndian32(bytes, 20)))
    .filter(_ => pngHasRasterPayloadAndEnd(bytes, offset = 33, sawImageData = false))

  @tailrec
  private def pngHasRasterPayloadAndEnd(
      bytes: Array[Byte],
      offset: Int,
      sawImageData: Boolean,
  ): Boolean =
    if offset + 8 > bytes.length then false
    else
      val chunkSize = bigEndian32(bytes, offset)
      val dataEnd = offset.toLong + 8L + chunkSize
      val nextChunk = dataEnd + 4L
      if chunkSize > Int.MaxValue.toLong || nextChunk > bytes.length.toLong then false
      else if matches(bytes, offset + 4, Array('I', 'E', 'N', 'D').map(_.toByte)) then
        sawImageData && chunkSize == 0L && nextChunk == bytes.length.toLong
      else
        val nextSawImageData = sawImageData ||
          (chunkSize > 0L && matches(bytes, offset + 4, Array('I', 'D', 'A', 'T').map(_.toByte)))
        pngHasRasterPayloadAndEnd(bytes, nextChunk.toInt, nextSawImageData)

  private def jpegDimensions(bytes: Array[Byte]): Option[ImageDimensions] =
    @tailrec
    def scan(offset: Int, maybeDimensions: Option[ImageDimensions]): Option[ImageDimensions] =
      if offset + 3 >= bytes.length then None
      else if unsignedByte(bytes, offset) != 0xff then scan(offset + 1, maybeDimensions)
      else
        val markerOffset = skipJpegFill(bytes, offset + 1)
        if markerOffset >= bytes.length then None
        else
          val marker = unsignedByte(bytes, markerOffset)
          val next = markerOffset + 1
          if isStandaloneJpegMarker(marker) then scan(next, maybeDimensions)
          else if next + 2 > bytes.length then None
          else
            val length = bigEndian16(bytes, next).toInt
            val dataStart = next + 2
            val nextSegment = dataStart + length - 2
            if length < 2 || nextSegment > bytes.length then None
            else if marker == JpegStartOfScanMarker then
              scanJpegEntropy(bytes, nextSegment, maybeDimensions)
            else if isJpegStartOfFrame(marker) && length >= 7 then
              scan(
                nextSegment,
                Some(ImageDimensions(
                  bigEndian16(bytes, dataStart + 3),
                  bigEndian16(bytes, dataStart + 1),
                )),
              )
            else scan(nextSegment, maybeDimensions)

    Option.when(bytes.length >= 4)(()).flatMap(_ => scan(2, None))

  @tailrec
  private def scanJpegEntropy(
      bytes: Array[Byte],
      offset: Int,
      maybeDimensions: Option[ImageDimensions],
  ): Option[ImageDimensions] =
    if offset + 1 >= bytes.length then None
    else if unsignedByte(bytes, offset) == 0xff && unsignedByte(bytes, offset + 1) == JpegEndMarker
    then maybeDimensions
    else scanJpegEntropy(bytes, offset + 1, maybeDimensions)

  private def webpDimensions(bytes: Array[Byte]): Option[ImageDimensions] =
    val riffSize = Option.when(bytes.length >= 12)(littleEndian32(bytes, 4))
    val riffEnd = riffSize.map(8L + _)

    @tailrec
    def scan(offset: Int, canvasDimensions: Option[ImageDimensions]): Option[ImageDimensions] =
      if offset + 8 > riffEnd.getOrElse(0L) then None
      else
        val chunkSize = littleEndian32(bytes, offset + 4)
        val dataStart = offset + 8
        val dataEnd = dataStart.toLong + chunkSize
        val paddedEnd = dataEnd + (chunkSize % 2L)
        if chunkSize > Int.MaxValue.toLong || dataEnd > riffEnd.getOrElse(0L) ||
          paddedEnd > riffEnd.getOrElse(0L)
        then None
        else if matches(bytes, offset, Array('V', 'P', '8', 'X').map(_.toByte)) && chunkSize >= 10L
        then
          val dimensions = ImageDimensions(
            littleEndian24(bytes, dataStart + 4) + 1L,
            littleEndian24(bytes, dataStart + 7) + 1L,
          )
          scan(paddedEnd.toInt, Some(dimensions))
        else if matches(bytes, offset, Array('V', 'P', '8', 'L').map(_.toByte)) && chunkSize >= 5L
        then
          webpLosslessDimensions(bytes, dataStart)
            .map(dimensions => canvasDimensions.getOrElse(dimensions))
        else if matches(bytes, offset, Array('V', 'P', '8', ' ').map(_.toByte)) && chunkSize >= 10L
        then
          webpLossyDimensions(bytes, dataStart)
            .map(dimensions => canvasDimensions.getOrElse(dimensions))
        else scan(paddedEnd.toInt, canvasDimensions)

    Option.when(
      bytes.length >= 20 && riffEnd.exists(_ == bytes.length.toLong) &&
        matches(bytes, 0, Array('R', 'I', 'F', 'F').map(_.toByte)) &&
        matches(bytes, 8, Array('W', 'E', 'B', 'P').map(_.toByte))
    )(()).flatMap(_ => scan(12, None))

  private def webpLosslessDimensions(bytes: Array[Byte], dataStart: Int): Option[ImageDimensions] =
    Option.when(unsignedByte(bytes, dataStart) == 0x2f) {
      val bits = littleEndian32(bytes, dataStart + 1)
      ImageDimensions((bits & 0x3fffL) + 1L, ((bits >> 14) & 0x3fffL) + 1L)
    }

  private def webpLossyDimensions(bytes: Array[Byte], dataStart: Int): Option[ImageDimensions] =
    Option.when(matches(bytes, dataStart + 3, Array(0x9d.toByte, 0x01.toByte, 0x2a.toByte))) {
      ImageDimensions(
        littleEndian16(bytes, dataStart + 6) & 0x3fffL,
        littleEndian16(bytes, dataStart + 8) & 0x3fffL,
      )
    }

  private def isJpegStartOfFrame(marker: Int): Boolean = JpegStartOfFrameMarkers.contains(marker)

  private def isStandaloneJpegMarker(marker: Int): Boolean = marker == 0x01 || marker == 0xd8 ||
    marker == 0xd9 || (marker >= 0xd0 && marker <= 0xd7)

  @tailrec
  private def skipJpegFill(bytes: Array[Byte], offset: Int): Int =
    if offset < bytes.length && unsignedByte(bytes, offset) == 0xff then
      skipJpegFill(bytes, offset + 1)
    else offset

  private def matches(bytes: Array[Byte], offset: Int, expected: Array[Byte]): Boolean =
    offset >= 0 && offset + expected.length <= bytes.length &&
      expected.indices.forall(index => bytes(offset + index) == expected(index))

  private def unsignedByte(bytes: Array[Byte], offset: Int): Int = bytes(offset) & 0xff

  private def bigEndian16(bytes: Array[Byte], offset: Int): Long =
    (unsignedByte(bytes, offset).toLong << 8) | unsignedByte(bytes, offset + 1).toLong

  private def bigEndian32(bytes: Array[Byte], offset: Int): Long =
    (unsignedByte(bytes, offset).toLong << 24) | (unsignedByte(bytes, offset + 1).toLong << 16) |
      (unsignedByte(bytes, offset + 2).toLong << 8) | unsignedByte(bytes, offset + 3).toLong

  private def littleEndian16(bytes: Array[Byte], offset: Int): Long = unsignedByte(bytes, offset)
    .toLong | (unsignedByte(bytes, offset + 1).toLong << 8)

  private def littleEndian24(bytes: Array[Byte], offset: Int): Long = unsignedByte(bytes, offset)
    .toLong | (unsignedByte(bytes, offset + 1).toLong << 8) |
    (unsignedByte(bytes, offset + 2).toLong << 16)

  private def littleEndian32(bytes: Array[Byte], offset: Int): Long = unsignedByte(bytes, offset)
    .toLong | (unsignedByte(bytes, offset + 1).toLong << 8) |
    (unsignedByte(bytes, offset + 2).toLong << 16) | (unsignedByte(bytes, offset + 3).toLong << 24)
