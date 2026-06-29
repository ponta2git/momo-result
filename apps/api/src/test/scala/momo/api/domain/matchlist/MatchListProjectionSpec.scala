package momo.api.domain.matchlist

import java.time.Instant

import munit.FunSuite

import momo.api.domain.ids.MatchDraftId
import momo.api.domain.{
  MatchDraftStatus,
  MatchListItem,
  MatchListItemKind,
  MatchListKindFilter,
  MatchListSort,
  MatchListStatusFilter
}

final class MatchListProjectionSpec extends FunSuite:
  test("status filter policy classifies draft states"):
    assert(MatchListProjection.statusMatchesFilter(
      MatchDraftStatus.NeedsReview,
      MatchListStatusFilter.PreConfirm,
    ))
    assert(MatchListProjection.statusMatchesFilter(
      MatchDraftStatus.OcrRunning,
      MatchListStatusFilter.Incomplete,
    ))
    assert(!MatchListProjection.statusMatchesFilter(
      MatchDraftStatus.Confirmed,
      MatchListStatusFilter.PreConfirm,
    ))

  test("summary policy counts draft states consistently"):
    val summary = MatchListProjection.summarizeDraftStatuses(List(
      MatchDraftStatus.OcrRunning,
      MatchDraftStatus.OcrFailed,
      MatchDraftStatus.DraftReady,
      MatchDraftStatus.NeedsReview,
      MatchDraftStatus.Cancelled,
    ))

    assertEquals(summary.incompleteCount, 4)
    assertEquals(summary.ocrRunningCount, 1)
    assertEquals(summary.preConfirmCount, 3)
    assertEquals(summary.needsReviewCount, 1)

  test("kind and status filters decide which item classes can appear"):
    assert(MatchListProjection.includeMatches(MatchListKindFilter.All, MatchListStatusFilter.All))
    assert(MatchListProjection.includeDrafts(MatchListKindFilter.All, MatchListStatusFilter.All))
    assert(MatchListProjection
      .includeMatches(MatchListKindFilter.All, MatchListStatusFilter.Confirmed))
    assert(!MatchListProjection
      .includeDrafts(MatchListKindFilter.All, MatchListStatusFilter.Confirmed))

  test("status priority sort keeps review work before ready and failed drafts"):
    val base = Instant.parse("2026-06-01T00:00:00Z")
    val items = List(
      item("failed", MatchDraftStatus.OcrFailed, base.plusSeconds(3)),
      item("ready", MatchDraftStatus.DraftReady, base.plusSeconds(2)),
      item("review", MatchDraftStatus.NeedsReview, base.plusSeconds(1)),
      item("running", MatchDraftStatus.OcrRunning, base),
    )

    assertEquals(
      MatchListProjection.sortItems(items, MatchListSort.StatusPriority).map(_.id),
      List("running", "review", "ready", "failed"),
    )

  private def item(id: String, status: MatchDraftStatus, updatedAt: Instant): MatchListItem =
    MatchListItem(
      kind = MatchListItemKind.MatchDraft,
      id = id,
      matchId = None,
      matchDraftId = Some(MatchDraftId.unsafeFromString(id)),
      status = status.wire,
      heldEventId = None,
      matchNoInEvent = None,
      gameTitleId = None,
      seasonMasterId = None,
      mapMasterId = None,
      ownerMemberId = None,
      playedAt = None,
      createdAt = updatedAt,
      updatedAt = updatedAt,
      ranks = Nil,
    )
end MatchListProjectionSpec
