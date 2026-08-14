package momo.api.usecases.matches

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64

import munit.FunSuite

import momo.api.domain.ids.*
import momo.api.domain.{MatchListKindFilter, MatchListSort, MatchListStatusFilter}
import momo.api.errors.AppError
import momo.api.repositories.MatchListReadModel

final class MatchListCursorCodecSpec extends FunSuite:
  private val scope = MatchListCursorCodec.Scope(
    accountId = AccountId.unsafeFromString("account-1"),
    heldEventId = Some(HeldEventId.unsafeFromString("event-1")),
    gameTitleId = Some(GameTitleId.unsafeFromString("title-1")),
    seasonMasterId = Some(SeasonMasterId.unsafeFromString("season-1")),
    status = MatchListStatusFilter.NeedsReview,
    kind = MatchListKindFilter.MatchDraft,
    sort = MatchListSort.HeldAsc,
    pageSize = 25,
  )
  private val cursor = MatchListReadModel.Cursor(
    direction = MatchListReadModel.CursorDirection.After,
    page = 3,
    totalItems = 72,
    position = Some(MatchListReadModel.CursorPosition(
      statusPriority = 1,
      updatedAt = Instant.parse("2026-08-14T12:34:56.123456Z"),
      heldAt = Instant.parse("2026-08-01T00:00:00Z"),
      matchNoIsNull = false,
      matchNoSort = 7,
      kind = "match_draft",
      id = "draft-7",
    )),
  )

  test("round-trips the complete request scope, page snapshot, and stable position"):
    val encoded = MatchListCursorCodec.encode(scope, cursor)
    assert(encoded.length <= 4096)
    assertEquals(MatchListCursorCodec.decode(encoded, scope), Right(cursor))

  test("normalizes server-issued timestamps to PostgreSQL microsecond precision"):
    val nanosecondCursor = cursor.copy(position =
      cursor.position.map(position =>
        position.copy(
          updatedAt = position.updatedAt.plusNanos(789),
          heldAt = position.heldAt.plusNanos(789),
        )
      )
    )
    val encoded = MatchListCursorCodec.encode(scope, nanosecondCursor)
    assertEquals(MatchListCursorCodec.decode(encoded, scope), Right(cursor))

  test("rejects a cursor when any request-scope or page-size field changes"):
    val encoded = MatchListCursorCodec.encode(scope, cursor)
    val changedScopes = List(
      scope.copy(heldEventId = None),
      scope.copy(accountId = AccountId.unsafeFromString("account-2")),
      scope.copy(status = MatchListStatusFilter.All),
      scope.copy(kind = MatchListKindFilter.All),
      scope.copy(sort = MatchListSort.UpdatedDesc),
      scope.copy(pageSize = 50),
    )
    changedScopes.foreach(changed => assertInvalid(MatchListCursorCodec.decode(encoded, changed)))

  test("rejects oversized and malformed base64url values before JSON decoding"):
    assertInvalid(MatchListCursorCodec.decode("x" * 4097, scope))
    assertInvalid(MatchListCursorCodec.decode("%%%", scope))

  test("rejects unknown versions, enums, malformed IDs, numbers, and instants"):
    val valid = rawJson()
    List(
      valid.replace("\"version\":1", "\"version\":2"),
      valid.replace("\"direction\":\"after\"", "\"direction\":\"sideways\""),
      valid.replace("\"status\":\"needs_review\"", "\"status\":\"unknown\""),
      valid.replace("\"heldEventId\":\"event-1\"", "\"heldEventId\":\"\""),
      valid.replace("\"statusPriority\":1", "\"statusPriority\":99"),
      valid.replace("\"id\":\"draft-7\"", "\"id\":\"   \""),
      valid.replace("\"matchNoSort\":7", "\"matchNoSort\":0"),
      valid.replace("\"matchNoIsNull\":false", "\"matchNoIsNull\":true"),
      valid.replace("\"updatedAt\":\"2026-08-14T12:34:56.123456Z\"", "\"updatedAt\":\"nope\""),
      valid.replace(
        "\"updatedAt\":\"2026-08-14T12:34:56.123456Z\"",
        "\"updatedAt\":\"+10000-01-01T00:00:00Z\"",
      ),
      valid.replace(
        "\"updatedAt\":\"2026-08-14T12:34:56.123456Z\"",
        "\"updatedAt\":\"2026-08-14T12:34:56.123456789Z\"",
      ),
      valid.replace("\"page\":3", "\"page\":0"),
      valid.replace("\"totalItems\":72", "\"totalItems\":-1"),
    ).foreach(json => assertInvalid(MatchListCursorCodec.decode(encodeJson(json), scope)))

  test("rejects inconsistent direction and boundary shapes"):
    val valid = rawJson()
    val afterWithoutPosition = valid.replace(positionJson, "null")
    val firstPageAfter = valid.replace("\"page\":3", "\"page\":1")
    assertInvalid(MatchListCursorCodec.decode(encodeJson(afterWithoutPosition), scope))
    assertInvalid(MatchListCursorCodec.decode(encodeJson(firstPageAfter), scope))

  private def rawJson(): String =
    s"""{"version":1,"scope":{"accountId":"account-1","heldEventId":"event-1","gameTitleId":"title-1","seasonMasterId":"season-1","status":"needs_review","kind":"match_draft","sort":"held_asc","pageSize":25},"direction":"after","page":3,"totalItems":72,"position":$positionJson}"""

  private def positionJson: String =
    """{"statusPriority":1,"updatedAt":"2026-08-14T12:34:56.123456Z","heldAt":"2026-08-01T00:00:00Z","matchNoIsNull":false,"matchNoSort":7,"kind":"match_draft","id":"draft-7"}"""

  private def encodeJson(value: String): String = Base64.getUrlEncoder.withoutPadding
    .encodeToString(value.getBytes(StandardCharsets.UTF_8))

  private def assertInvalid(result: Either[AppError, MatchListReadModel.Cursor]): Unit =
    result match
      case Left(_: AppError.BadRequest) => ()
      case other => fail(s"expected BadRequest, got $other")
end MatchListCursorCodecSpec
