package momo.api.adapters.storage

import java.nio.charset.StandardCharsets.US_ASCII
import java.nio.{ByteBuffer, ByteOrder}

import munit.FunSuite

import momo.api.testing.TestImages

final class ImageValidationSpec extends FunSuite:
  test("a WebP canvas cannot conceal an oversized raster") {
    val bytes = extendedWebp(1, 1, TestImages.webp(ImageValidation.MaxWidth + 1, 1).drop(12))
    assert(ImageValidation.validate(bytes, Some("image/webp")).isLeft)
  }

  test("a valid extended WebP keeps the bitstream dimensions and accepts metadata") {
    val raster = TestImages.webp(1280, 720).drop(12)
    val bytes = extendedWebp(1280, 720, raster ++ chunk("EXIF", Array[Byte](1, 2)))
    val dimensions = ImageValidation.validate(bytes, Some("image/webp")).map(_.dimensions)
    assertEquals(dimensions.map(value => (value.width, value.height)), Right((1280L, 720L)))
  }

  test("duplicate WebP raster and canvas chunks cannot replace the validated image") {
    val raster = TestImages.webp(1, 1).drop(12)
    val duplicateRaster = extendedWebp(1, 1, raster ++ TestImages.webp(2000, 1).drop(12))
    val duplicateCanvas = extendedWebp(1, 1, extendedWebp(1, 1, raster).drop(12))
    assert(ImageValidation.validate(duplicateRaster, None).isLeft)
    assert(ImageValidation.validate(duplicateCanvas, None).isLeft)
  }

  test("WebP validation checks chunk bounds after the raster") {
    val truncatedChunk = "EXIF".getBytes(US_ASCII) ++ little32(20)
    val bytes = extendedWebp(1, 1, TestImages.webp(1, 1).drop(12) ++ truncatedChunk)
    assert(ImageValidation.validate(bytes, None).isLeft)
  }

  private def extendedWebp(width: Int, height: Int, payload: Array[Byte]): Array[Byte] =
    val canvas = Array.fill[Byte](4)(0) ++ little32(width - 1).take(3) ++
      little32(height - 1).take(3)
    val contents = "WEBP".getBytes(US_ASCII) ++ chunk("VP8X", canvas) ++ payload
    "RIFF".getBytes(US_ASCII) ++ little32(contents.length) ++ contents

  private def chunk(kind: String, bytes: Array[Byte]): Array[Byte] =
    kind.getBytes(US_ASCII) ++ little32(bytes.length) ++ bytes ++
      Array.fill[Byte](bytes.length % 2)(0)

  private def little32(value: Int): Array[Byte] = ByteBuffer.allocate(4)
    .order(ByteOrder.LITTLE_ENDIAN).putInt(value).array()
