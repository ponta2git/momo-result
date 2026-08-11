package momo.api.adapters.storage

import scala.annotation.tailrec

private[storage] object ImageFormatParsers:
  import ImageValidation.*

  def detect(bytes: Array[Byte]): Option[ImageType] =
    if PngParser.matchesSignature(bytes) then Some(Png)
    else if JpegParser.matchesSignature(bytes) then Some(Jpeg)
    else if WebpParser.matchesSignature(bytes) then Some(Webp)
    else None

  def dimensions(
      bytes: Array[Byte],
      imageType: ImageType,
  ): Option[ImageDimensions] =
    if imageType.mediaType == Png.mediaType then PngParser.dimensions(bytes)
    else if imageType.mediaType == Jpeg.mediaType then JpegParser.dimensions(bytes)
    else WebpParser.dimensions(bytes)

  private object PngParser:
    private val Signature =
      Array(
        0x89.toByte,
        0x50.toByte,
        0x4e.toByte,
        0x47.toByte,
        0x0d.toByte,
        0x0a.toByte,
        0x1a.toByte,
        0x0a.toByte
      )
    private val Ihdr = Array('I', 'H', 'D', 'R').map(_.toByte)
    private val Idat = Array('I', 'D', 'A', 'T').map(_.toByte)
    private val Iend = Array('I', 'E', 'N', 'D').map(_.toByte)

    def matchesSignature(bytes: Array[Byte]): Boolean = ImageBytes.matches(bytes, 0, Signature)

    def dimensions(bytes: Array[Byte]): Option[ImageDimensions] = Option.when(
      bytes.length >= 33 && ImageBytes.bigEndian32(bytes, 8) == 13L &&
        ImageBytes.matches(bytes, 12, Ihdr)
    )(ImageDimensions(ImageBytes.bigEndian32(bytes, 16), ImageBytes.bigEndian32(bytes, 20)))
      .filter(_ => hasRasterPayloadAndEnd(bytes, offset = 33, sawImageData = false))

    @tailrec
    private def hasRasterPayloadAndEnd(
        bytes: Array[Byte],
        offset: Int,
        sawImageData: Boolean,
    ): Boolean =
      if offset + 8 > bytes.length then false
      else
        val chunkSize = ImageBytes.bigEndian32(bytes, offset)
        val dataEnd = offset.toLong + 8L + chunkSize
        val nextChunk = dataEnd + 4L
        if chunkSize > Int.MaxValue.toLong || nextChunk > bytes.length.toLong then false
        else if ImageBytes.matches(bytes, offset + 4, Iend) then
          sawImageData && chunkSize == 0L && nextChunk == bytes.length.toLong
        else
          val nextSawImageData = sawImageData ||
            (chunkSize > 0L && ImageBytes.matches(bytes, offset + 4, Idat))
          hasRasterPayloadAndEnd(bytes, nextChunk.toInt, nextSawImageData)

  private object JpegParser:
    private val StartOfFrameMarkers: Set[Int] =
      Set(0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf)
    private val StartOfScanMarker = 0xda
    private val EndMarker = 0xd9
    private val Signature = Array(0xff.toByte, 0xd8.toByte, 0xff.toByte)

    def matchesSignature(bytes: Array[Byte]): Boolean = ImageBytes.matches(bytes, 0, Signature)

    def dimensions(bytes: Array[Byte]): Option[ImageDimensions] =
      @tailrec
      def scan(offset: Int, maybeDimensions: Option[ImageDimensions]): Option[ImageDimensions] =
        if offset + 3 >= bytes.length then None
        else if ImageBytes.unsignedByte(bytes, offset) != 0xff then
          scan(offset + 1, maybeDimensions)
        else
          val markerOffset = skipFill(bytes, offset + 1)
          if markerOffset >= bytes.length then None
          else
            val marker = ImageBytes.unsignedByte(bytes, markerOffset)
            val next = markerOffset + 1
            if isStandaloneMarker(marker) then scan(next, maybeDimensions)
            else if next + 2 > bytes.length then None
            else
              val length = ImageBytes.bigEndian16(bytes, next).toInt
              val dataStart = next + 2
              val nextSegment = dataStart + length - 2
              if length < 2 || nextSegment > bytes.length then None
              else if marker == StartOfScanMarker then
                scanEntropy(bytes, nextSegment, maybeDimensions)
              else if isStartOfFrame(marker) && length >= 7 then
                scan(
                  nextSegment,
                  Some(ImageDimensions(
                    ImageBytes.bigEndian16(bytes, dataStart + 3),
                    ImageBytes.bigEndian16(bytes, dataStart + 1),
                  )),
                )
              else scan(nextSegment, maybeDimensions)

      Option.when(bytes.length >= 4)(()).flatMap(_ => scan(2, None))

    @tailrec
    private def scanEntropy(
        bytes: Array[Byte],
        offset: Int,
        maybeDimensions: Option[ImageDimensions],
    ): Option[ImageDimensions] =
      if offset + 1 >= bytes.length then None
      else if ImageBytes.unsignedByte(bytes, offset) == 0xff &&
        ImageBytes.unsignedByte(bytes, offset + 1) == EndMarker
      then maybeDimensions
      else scanEntropy(bytes, offset + 1, maybeDimensions)

    private def isStartOfFrame(marker: Int): Boolean = StartOfFrameMarkers.contains(marker)

    private def isStandaloneMarker(marker: Int): Boolean = marker == 0x01 || marker == 0xd8 ||
      marker == 0xd9 || (marker >= 0xd0 && marker <= 0xd7)

    @tailrec
    private def skipFill(bytes: Array[Byte], offset: Int): Int =
      if offset < bytes.length && ImageBytes.unsignedByte(bytes, offset) == 0xff then
        skipFill(bytes, offset + 1)
      else offset

  private object WebpParser:
    private val Riff = Array('R', 'I', 'F', 'F').map(_.toByte)
    private val Webp = Array('W', 'E', 'B', 'P').map(_.toByte)
    private val Vp8x = Array('V', 'P', '8', 'X').map(_.toByte)
    private val Vp8l = Array('V', 'P', '8', 'L').map(_.toByte)
    private val Vp8 = Array('V', 'P', '8', ' ').map(_.toByte)
    private val LossyFrameTag = Array(0x9d.toByte, 0x01.toByte, 0x2a.toByte)

    def matchesSignature(bytes: Array[Byte]): Boolean =
      bytes.length >= 12 && ImageBytes.matches(bytes, 0, Riff) &&
        ImageBytes.matches(bytes, 8, Webp)

    def dimensions(bytes: Array[Byte]): Option[ImageDimensions] =
      val riffSize = Option.when(bytes.length >= 12)(ImageBytes.littleEndian32(bytes, 4))
      val riffEnd = riffSize.map(8L + _)

      @tailrec
      def scan(offset: Int, canvasDimensions: Option[ImageDimensions]): Option[ImageDimensions] =
        if offset + 8 > riffEnd.getOrElse(0L) then None
        else
          val chunkSize = ImageBytes.littleEndian32(bytes, offset + 4)
          val dataStart = offset + 8
          val dataEnd = dataStart.toLong + chunkSize
          val paddedEnd = dataEnd + (chunkSize % 2L)
          if chunkSize > Int.MaxValue.toLong || dataEnd > riffEnd.getOrElse(0L) ||
            paddedEnd > riffEnd.getOrElse(0L)
          then None
          else if ImageBytes.matches(bytes, offset, Vp8x) && chunkSize >= 10L then
            val dimensions = ImageDimensions(
              ImageBytes.littleEndian24(bytes, dataStart + 4) + 1L,
              ImageBytes.littleEndian24(bytes, dataStart + 7) + 1L,
            )
            scan(paddedEnd.toInt, Some(dimensions))
          else if ImageBytes.matches(bytes, offset, Vp8l) && chunkSize >= 5L then
            losslessDimensions(bytes, dataStart)
              .map(dimensions => canvasDimensions.getOrElse(dimensions))
          else if ImageBytes.matches(bytes, offset, Vp8) && chunkSize >= 10L then
            lossyDimensions(bytes, dataStart).map(dimensions =>
              canvasDimensions.getOrElse(dimensions)
            )
          else scan(paddedEnd.toInt, canvasDimensions)

      Option.when(bytes.length >= 20 && riffEnd.exists(_ == bytes.length.toLong) &&
        matchesSignature(bytes))(()).flatMap(_ => scan(12, None))

    private def losslessDimensions(bytes: Array[Byte], dataStart: Int): Option[ImageDimensions] =
      Option.when(ImageBytes.unsignedByte(bytes, dataStart) == 0x2f) {
        val bits = ImageBytes.littleEndian32(bytes, dataStart + 1)
        ImageDimensions((bits & 0x3fffL) + 1L, ((bits >> 14) & 0x3fffL) + 1L)
      }

    private def lossyDimensions(bytes: Array[Byte], dataStart: Int): Option[ImageDimensions] =
      Option.when(ImageBytes.matches(bytes, dataStart + 3, LossyFrameTag)) {
        ImageDimensions(
          ImageBytes.littleEndian16(bytes, dataStart + 6) & 0x3fffL,
          ImageBytes.littleEndian16(bytes, dataStart + 8) & 0x3fffL,
        )
      }

  private object ImageBytes:
    def matches(bytes: Array[Byte], offset: Int, expected: Array[Byte]): Boolean =
      offset >= 0 && offset + expected.length <= bytes.length &&
        expected.indices.forall(index => bytes(offset + index) == expected(index))

    def unsignedByte(bytes: Array[Byte], offset: Int): Int = bytes(offset) & 0xff

    def bigEndian16(bytes: Array[Byte], offset: Int): Long =
      (unsignedByte(bytes, offset).toLong << 8) | unsignedByte(bytes, offset + 1).toLong

    def bigEndian32(bytes: Array[Byte], offset: Int): Long =
      (unsignedByte(bytes, offset).toLong << 24) | (unsignedByte(bytes, offset + 1).toLong << 16) |
        (unsignedByte(bytes, offset + 2).toLong << 8) | unsignedByte(bytes, offset + 3).toLong

    def littleEndian16(bytes: Array[Byte], offset: Int): Long = unsignedByte(bytes, offset)
      .toLong | (unsignedByte(bytes, offset + 1).toLong << 8)

    def littleEndian24(bytes: Array[Byte], offset: Int): Long = unsignedByte(bytes, offset)
      .toLong | (unsignedByte(bytes, offset + 1).toLong << 8) |
      (unsignedByte(bytes, offset + 2).toLong << 16)

    def littleEndian32(bytes: Array[Byte], offset: Int): Long = unsignedByte(bytes, offset)
      .toLong | (unsignedByte(bytes, offset + 1).toLong << 8) |
      (unsignedByte(bytes, offset + 2).toLong << 16) |
      (unsignedByte(bytes, offset + 3).toLong << 24)
