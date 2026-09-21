package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.*

final case class OcrSubmissionMember(
    screenType: ScreenType,
    uploadIdempotencyKeyHash: String,
    imageSha256: String,
    imageByteLength: Int,
    status: String = "pending",
    jobId: Option[OcrJobId] = None,
    failureCode: Option[String] = None,
)

/** The member set and reading conditions are immutable after admission. */
final case class OcrSubmission(
    id: String,
    ownerAccountId: AccountId,
    matchDraftId: MatchDraftId,
    ocrHints: OcrJobHints,
    status: String,
    admissionDeadline: Instant,
    createdAt: Instant,
    finishedAt: Option[Instant],
    members: List[OcrSubmissionMember],
):
  def sameRequest(other: OcrSubmission): Boolean =
    ownerAccountId == other.ownerAccountId && matchDraftId == other.matchDraftId &&
      momo.api.codec.OcrHintsCodec.encode(ocrHints) == momo.api.codec.OcrHintsCodec.encode(other.ocrHints) &&
      members.sortBy(_.screenType.wire).map(m =>
        (m.screenType, m.uploadIdempotencyKeyHash, m.imageSha256, m.imageByteLength)
      ) == other.members.sortBy(_.screenType.wire).map(m =>
        (m.screenType, m.uploadIdempotencyKeyHash, m.imageSha256, m.imageByteLength)
      )
