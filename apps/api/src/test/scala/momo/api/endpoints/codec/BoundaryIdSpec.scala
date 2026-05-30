package momo.api.endpoints.codec

import munit.FunSuite

import momo.api.domain.ids.MatchDraftId
import momo.api.errors.AppError

final class BoundaryIdSpec extends FunSuite:
  test("required trims boundary ids before parsing"):
    assertEquals(
      BoundaryId.required("matchDraftId", "  draft-1  ")(MatchDraftId.fromString),
      Right(MatchDraftId.unsafeFromString("draft-1")),
    )

  test("required rejects control characters in boundary ids"):
    assertEquals(
      BoundaryId.required("matchDraftId", "draft-1\nother")(MatchDraftId.fromString),
      Left(AppError.ValidationFailed("matchDraftId must not contain control characters.")),
    )

  test("optional rejects control characters in boundary ids"):
    assertEquals(
      BoundaryId.optional("matchDraftId", Some("draft-1\tother"))(MatchDraftId.fromString),
      Left(AppError.ValidationFailed("matchDraftId must not contain control characters.")),
    )
end BoundaryIdSpec
