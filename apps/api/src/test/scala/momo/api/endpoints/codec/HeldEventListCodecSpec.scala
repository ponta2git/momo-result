package momo.api.endpoints.codec

import java.time.{Instant, LocalDate}

import munit.FunSuite

import momo.api.domain.ids.{GameTitleId, MapMasterId, MemberId, SeasonMasterId}
import momo.api.domain.{
  HeldEventListMetric,
  HeldEventListMetricCriterion,
  HeldEventListSearchCriteria,
  HeldEventListSort,
  MatchListRecordRange
}
import momo.api.errors.AppError
import momo.api.usecases.heldevents.ListHeldEventsCommand

final class HeldEventListCodecSpec extends FunSuite:
  private val empty = HeldEventListCodec.SearchParams.empty

  private def parse(
      search: HeldEventListCodec.SearchParams,
      sort: Option[String],
  ): Either[AppError, ListHeldEventsCommand] = HeldEventListCodec.toListCommand(
    limit = None,
    page = None,
    pageSize = None,
    sort = sort,
    search = search,
  )

  private def search(params: HeldEventListCodec.SearchParams) = parse(params, None).map(_.search)

  private def metric(params: HeldEventListCodec.SearchParams) = search(params).map(_.metric)

  private def assertRejected(result: Either[AppError, ?], fragment: String): Unit = result match
    case Left(AppError.ValidationFailed(detail)) =>
      assert(detail.contains(fragment), s"'$detail' should mention '$fragment'")
    case other => fail(s"expected ValidationFailed mentioning $fragment, got $other")

  test("keeps the unfiltered newest-first contract when no parameter is present"):
    val command = parse(empty, None).fold(e => fail(e.toString), identity)
    assertEquals(command.sort, HeldEventListSort.HeldDesc)
    assert(command.search.isEmpty)
    assertEquals(parse(empty, Some("held_asc")).map(_.sort), Right(HeldEventListSort.HeldAsc))

  test("parses every criterion and defaults metricRange to gte"):
    val parsed = search(empty.copy(
      gameTitleId = Some("title_world"),
      seasonMasterId = Some("season_2024_spring"),
      mapMasterId = Some("map_east"),
      from = Some("2026-04-01"),
      to = Some("2026-04-01"),
      minMatchCount = Some(1),
      q = Some("　  100%_Note ﻿ "),
      memberId = Some("member_ponta"),
      metric = Some("average_rank"),
      metricValue = Some("2.5"),
    ))
    assertEquals(
      parsed,
      Right(HeldEventListSearchCriteria(
        gameTitleId = Some(GameTitleId.unsafeFromString("title_world")),
        seasonMasterId = Some(SeasonMasterId.unsafeFromString("season_2024_spring")),
        mapMasterId = Some(MapMasterId.unsafeFromString("map_east")),
        from = Some(LocalDate.parse("2026-04-01")),
        to = Some(LocalDate.parse("2026-04-01")),
        minMatchCount = Some(1),
        noteQuery = Some("100%_Note"),
        metric = Some(HeldEventListMetricCriterion(
          HeldEventListMetric.AverageRank,
          BigDecimal("2.5"),
          MatchListRecordRange.Gte,
          Some(MemberId.unsafeFromString("member_ponta")),
        )),
      )),
    )

  test("converts inclusive JST dates to a half-open start-time range"):
    val criteria = HeldEventListSearchCriteria(
      from = Some(LocalDate.parse("2026-04-01")),
      to = Some(LocalDate.parse("2026-04-30")),
    )
    assertEquals(criteria.heldFromInclusive, Some(Instant.parse("2026-03-31T15:00:00Z")))
    assertEquals(criteria.heldToExclusive, Some(Instant.parse("2026-04-30T15:00:00Z")))

  test("treats a blank q as absent and applies the match-list q limits"):
    assertEquals(
      search(empty.copy(q = Some(" 　 ﻿ \t\r\n"))),
      Right(HeldEventListSearchCriteria.empty),
    )
    val surrogatePair = "𠮷"
    assert(search(empty.copy(q = Some(surrogatePair * 50))).isRight)
    assertRejected(search(empty.copy(q = Some(surrogatePair * 51))), "q must be at most 50")
    assertRejected(search(empty.copy(q = Some("a\u0000b"))), "control characters")

  test("rejects unknown sorts, malformed IDs, dates, reversed ranges and match counts below 1"):
    assertRejected(parse(empty, Some("updated_desc")), "sort must be held_desc or held_asc")
    assertRejected(search(empty.copy(gameTitleId = Some(""))), "gameTitleId")
    assertRejected(search(empty.copy(from = Some("2026-4-01"))), "from")
    assertRejected(search(empty.copy(to = Some("2026-02-30"))), "to")
    assertRejected(
      search(empty.copy(from = Some("2026-04-02"), to = Some("2026-04-01"))),
      "from must be on or before to",
    )
    assertRejected(search(empty.copy(minMatchCount = Some(0))), "minMatchCount must be 1")

  test("requires metric and metricValue together and rejects dependents without metric"):
    assertRejected(
      metric(empty.copy(metric = Some("rank1_count"))),
      "metricValue is required when metric is specified",
    )
    assertRejected(metric(empty.copy(metricValue = Some("1"))), "metricValue requires metric")
    assertRejected(metric(empty.copy(metricRange = Some("lte"))), "metricRange requires metric")
    assertRejected(metric(empty.copy(memberId = Some("member_ponta"))), "memberId requires metric")
    assertRejected(metric(empty.copy(metric = Some("rank"), metricValue = Some("1"))), "metric")
    assertRejected(
      metric(empty.copy(
        metric = Some("rank1_count"),
        metricValue = Some("1"),
        metricRange = Some("eq")
      )),
      "metricRange must be gte or lte",
    )

  test("accepts average ranks from 1.00 to 4.00 with at most two decimal places"):
    List("1", "1.00", "2.5", "3.99", "4", "4.00").foreach(raw =>
      assertEquals(
        metric(empty.copy(metric = Some("average_rank"), metricValue = Some(raw)))
          .map(_.map(_.value)),
        Right(Some(BigDecimal(raw))),
        raw,
      )
    )
    List("0.99", "4.01", "2.505", "2.", ".5", "+2", "2e0", " 2", "two").foreach(raw =>
      assertRejected(
        metric(empty.copy(metric = Some("average_rank"), metricValue = Some(raw))),
        "1.00 to 4.00",
      )
    )

  test("accepts rank counts of 0 or greater as integers and honors lte"):
    assertEquals(
      metric(empty.copy(
        metric = Some("rank4_count"),
        metricValue = Some("0"),
        metricRange = Some("lte")
      )),
      Right(Some(HeldEventListMetricCriterion(
        HeldEventListMetric.Rank4Count,
        BigDecimal(0),
        MatchListRecordRange.Lte,
        None,
      ))),
    )
    List("-1", "1.5", "1.0", "99999999999", "").foreach(raw =>
      assertRejected(
        metric(empty.copy(metric = Some("rank2_count"), metricValue = Some(raw))),
        "integer of 0 or greater",
      )
    )
end HeldEventListCodecSpec
