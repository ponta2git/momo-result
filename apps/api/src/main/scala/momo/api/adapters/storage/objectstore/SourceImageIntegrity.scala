package momo.api.adapters.storage.objectstore

import cats.syntax.all.*

import momo.api.ports.storage.{
  Sha256Hex,
  SourceImageObject,
  SourceImageObjectKey,
  SourceImageObjectMetadata
}
import momo.api.repositories.SourceImageRecord

private[objectstore] object SourceImageIntegrity:
  final case class ExpectedMetadata(
      key: SourceImageObjectKey,
      mediaType: String,
      sizeBytes: Long,
      sha256: Sha256Hex,
      width: Int,
      height: Int,
  )

  def expected(record: SourceImageRecord): Option[ExpectedMetadata] =
    (
      record.mediaType,
      record.sizeBytes,
      record.sha256,
      record.width,
      record.height,
    ).mapN((mediaType, sizeBytes, sha256, width, height) =>
      ExpectedMetadata(record.objectKey, mediaType, sizeBytes, sha256, width, height)
    )

  def metadataMatches(
      expected: ExpectedMetadata,
      actual: SourceImageObjectMetadata,
  ): Boolean = actual.key == expected.key && actual.mediaType == expected.mediaType &&
    actual.sizeBytes == expected.sizeBytes && actual.sha256 == expected.sha256

  def matches(record: SourceImageRecord, sourceObject: SourceImageObject): Boolean =
    expected(record).exists { expected =>
      metadataMatches(expected, sourceObject.metadata) &&
      sourceObject.format.dimensions.width == expected.width.toLong &&
      sourceObject.format.dimensions.height == expected.height.toLong
    }
