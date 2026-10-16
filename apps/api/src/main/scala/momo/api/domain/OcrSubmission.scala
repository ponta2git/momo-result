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
  /** Evaluate fresh admission only; registered jobs are replayed before this decision. */
  def canAdmit(screenType: ScreenType, now: Instant): Boolean =
    status == "open" && now.isBefore(admissionDeadline) &&
      members.exists(member => member.screenType == screenType && member.status == "pending")

  def sameRequest(other: OcrSubmission): Boolean =
    ownerAccountId == other.ownerAccountId && matchDraftId == other.matchDraftId &&
      ocrHints == other.ocrHints &&
      members.sortBy(_.screenType.wire).map(m =>
        (m.screenType, m.uploadIdempotencyKeyHash, m.imageSha256, m.imageByteLength)
      ) == other.members.sortBy(_.screenType.wire).map(m =>
        (m.screenType, m.uploadIdempotencyKeyHash, m.imageSha256, m.imageByteLength)
      )

object OcrSubmission:
  /** New requests contain distinct explicit members with no persisted outcomes. */
  def validateNewMembers(members: List[OcrSubmissionMember]): Either[String, Unit] =
    if members.isEmpty || members.size > 3 ||
      members.map(_.screenType).distinct.size != members.size ||
      members.map(_.uploadIdempotencyKeyHash).distinct.size != members.size
    then Left("Choose one to three distinct OCR screen types.")
    else if members.exists(_.screenType == ScreenType.Auto) then
      Left("Choose an explicit OCR screen type.")
    else if members.exists(m => m.status != "pending" || m.jobId.nonEmpty || m.failureCode.nonEmpty)
    then Left("New OCR submission members must be pending without outcomes.")
    else Right(())
