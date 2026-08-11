package momo.api.ports.storage

import munit.FunSuite

import momo.api.domain.ids.ImageId

final class SourceImageObjectStorageSpec extends FunSuite:
  test("object keys are generated without account identifiers"):
    val imageId = ImageId.unsafeFromString("018f50e2-88aa-7d1d-a8a6-9f3f8cf58d90")
    val result = SourceImageObjectKey.forImage(imageId, "png")

    assert(result.exists(_.value.startsWith("source-images/v1/")))
    assert(result.exists(_.value.endsWith(s"/${imageId.value}.png")))

  test("object keys reject URLs, traversal, and empty path segments"):
    val invalid = List(
      "",
      "/source-images/image.png",
      "https://example.invalid/image.png",
      "source-images/../image.png",
      "source-images//image.png",
    )

    assert(invalid.forall(SourceImageObjectKey.fromString(_).isLeft))

  test("SHA-256 values require canonical lowercase hexadecimal encoding"):
    val valid = "a" * 64

    assertEquals(Sha256Hex.fromString(valid).map(_.value), Right(valid))
    assert(Sha256Hex.fromString("A" * 64).isLeft)
    assert(Sha256Hex.fromString("a" * 63).isLeft)
