package momo.api.endpoints.codec

import java.time.{Instant, LocalDate}

import munit.FunSuite

import momo.api.domain.ids.{MapMasterId, MemberId}
import momo.api.domain.{
  MatchListKindFilter,
  MatchListRecordCriterion,
  MatchListRecordField,
  MatchListRecordRange,
  MatchListSearchCriteria
}
import momo.api.errors.AppError
import momo.api.usecases.matches.ListMatchesCommand

final class MatchListCodecSpec extends FunSuite:
  private val empty = MatchListCodec.SearchParams.empty

  private def parse(
      search: MatchListCodec.SearchParams,
      kind: Option[String],
  ): Either[AppError, ListMatchesCommand] = MatchListCodec.toListCommand(
    heldEventId = None,
    gameTitleId = None,
    seasonMasterId = None,
    status = None,
    kind = kind,
    pageSize = None,
    cursor = None,
    sort = None,
    search = search,
  )

  private def matchSearch(search: MatchListCodec.SearchParams) = parse(search, Some("match"))
    .map(_.search)

  private def assertRejected(result: Either[AppError, ?], fragment: String): Unit = result match
    case Left(AppError.ValidationFailed(detail)) =>
      assert(detail.contains(fragment), s"'$detail' should mention '$fragment'")
    case other => fail(s"expected ValidationFailed mentioning $fragment, got $other")

  test("keeps the draft list contract when no search criterion is present"):
    val command = parse(empty, Some("match_draft")).fold(e => fail(e.toString), identity)
    assertEquals(command.kind, MatchListKindFilter.MatchDraft)
    assert(command.search.isEmpty)

  test("parses every confirmed-match criterion and defaults recordRange to gte"):
    val parsed = matchSearch(empty.copy(
      mapMasterId = Some("map_east"),
      from = Some("2026-04-01"),
      to = Some("2026-04-01"),
      q = Some("\u3000\u00a0 100%_Note \ufeff\u2028"),
      memberId = Some("member_ponta"),
      record = Some("suri_no_ginji"),
      recordValue = Some(0),
    ))
    assertEquals(
      parsed,
      Right(MatchListSearchCriteria(
        mapMasterId = Some(MapMasterId.unsafeFromString("map_east")),
        from = Some(LocalDate.parse("2026-04-01")),
        to = Some(LocalDate.parse("2026-04-01")),
        noteQuery = Some("100%_Note"),
        record = Some(MatchListRecordCriterion(
          MatchListRecordField.SuriNoGinji,
          0,
          MatchListRecordRange.Gte,
          Some(MemberId.unsafeFromString("member_ponta")),
        )),
      )),
    )

  test("converts inclusive JST dates to a half-open held-at instant range"):
    val criteria = MatchListSearchCriteria(
      from = Some(LocalDate.parse("2026-04-01")),
      to = Some(LocalDate.parse("2026-04-30")),
    )
    assertEquals(criteria.heldFromInclusive, Some(Instant.parse("2026-03-31T15:00:00Z")))
    assertEquals(criteria.heldToExclusive, Some(Instant.parse("2026-04-30T15:00:00Z")))

  test("treats a blank q as absent and allows negative revenue"):
    assertEquals(
      matchSearch(empty.copy(q = Some(" \u3000\u00a0\ufeff\u2028\t\r\n"))),
      Right(MatchListSearchCriteria.empty),
    )
    assertEquals(
      matchSearch(empty.copy(
        record = Some("revenue"),
        recordValue = Some(-30),
        recordRange = Some("lte")
      ))
        .map(_.record),
      Right(Some(MatchListRecordCriterion(
        MatchListRecordField.Revenue,
        -30,
        MatchListRecordRange.Lte,
        None,
      ))),
    )

  test("accepts q of exactly 50 code points and rejects 51"):
    val surrogatePair = "𠮷"
    assert(matchSearch(empty.copy(q = Some(surrogatePair * 50))).isRight)
    assertRejected(matchSearch(empty.copy(q = Some(surrogatePair * 51))), "q")

  test("rejects malformed and reversed date ranges"):
    assertRejected(matchSearch(empty.copy(from = Some("2026-4-01"))), "from")
    assertRejected(matchSearch(empty.copy(to = Some("2026-02-30"))), "to")
    assertRejected(matchSearch(empty.copy(from = Some("+12026-01-01"))), "from")
    assertRejected(
      matchSearch(empty.copy(from = Some("2026-04-02"), to = Some("2026-04-01"))),
      "from must be on or before to",
    )

  test("requires record and recordValue together and rejects dependents without record"):
    assertRejected(matchSearch(empty.copy(record = Some("destination"))), "recordValue")
    assertRejected(matchSearch(empty.copy(recordValue = Some(1))), "recordValue requires record")
    assertRejected(
      matchSearch(empty.copy(recordRange = Some("lte"))),
      "recordRange requires record"
    )
    assertRejected(
      matchSearch(empty.copy(memberId = Some("member_ponta"))),
      "memberId requires record"
    )

  test("rejects unknown record fields, ranges, and negative incident counts"):
    assertRejected(matchSearch(empty.copy(record = Some("rank"), recordValue = Some(1))), "record")
    assertRejected(
      matchSearch(empty.copy(
        record = Some("revenue"),
        recordValue = Some(1),
        recordRange = Some("eq")
      )),
      "recordRange",
    )
    assertRejected(
      matchSearch(empty.copy(record = Some("card_shop"), recordValue = Some(-1))),
      "0 or greater",
    )

  test("rejects confirmed-match criteria unless kind is match"):
    val criterion = empty.copy(mapMasterId = Some("map_east"))
    List(None, Some("all"), Some("match_draft")).foreach(kind =>
      assertRejected(parse(criterion, kind), "kind must be match")
    )
end MatchListCodecSpec
