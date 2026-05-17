package momo.api.endpoints.codec

import munit.FunSuite

import momo.api.domain.OcrDraft
import momo.api.errors.AppError

final class OcrDraftCodecSpec extends FunSuite:
  test("rejects too many bulk ids before parsing every id"):
    val ids = (1 to (OcrDraft.MaxBulkIds + 1)).map(index => s"draft-$index").mkString(",")

    assertEquals(
      OcrDraftCodec.toDraftIds(ids),
      Left(AppError.ValidationFailed(
        s"ids query must contain at most ${OcrDraft.MaxBulkIds.toString} ids."
      )),
    )
end OcrDraftCodecSpec
