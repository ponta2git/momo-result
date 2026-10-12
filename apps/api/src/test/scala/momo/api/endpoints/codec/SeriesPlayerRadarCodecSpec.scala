package momo.api.endpoints.codec

import io.circe.parser.decode
import munit.FunSuite

import momo.api.endpoints.{
  SeriesPlayerRadarManualAxisRequest,
  SeriesPlayerRadarManualInputRequest,
  SeriesPlayerRadarOperationRequest
}

final class SeriesPlayerRadarCodecSpec extends FunSuite:
  private val ids = List(
    "averageRank",
    "revenueP90",
    "revenueAverage",
    "totalAssetsP10",
    "totalAssetsMedian",
    "totalAssetsP90"
  )
  private val input = SeriesPlayerRadarManualInputRequest(ids.map { id =>
    SeriesPlayerRadarManualAxisRequest(
      id,
      if id == "averageRank" then (1 to 9).reverse.map(_ * 1.0).toList
      else (-4 to 4).map(_ * 1.0).toList
    )
  })
  private val request = SeriesPlayerRadarOperationRequest(
    "title",
    "manual",
    None,
    None,
    None,
    None,
    None,
    sourceBasisId = Some("source"),
    manualInput = Some(input)
  )

  test(
    "manual boundaries accept finite decimals, negative money and zero while requiring every ordered axis"
  ):
    assert(SeriesPlayerRadarCodec.command(request).isRight)
    val invalid = List(
      input.copy(axes = input.axes.tail),
      input.copy(axes = input.axes.reverse),
      input.copy(axes = input.axes.updated(1, input.axes.head)),
      input.copy(axes = input.axes.updated(1, input.axes(1).copy(thresholds = List.fill(9)(0.0)))),
      input.copy(axes =
        input.axes.updated(1, input.axes(1).copy(thresholds = List.fill(9)(Double.NaN)))
      ),
      input.copy(axes =
        input.axes.updated(
          0,
          input.axes.head.copy(thresholds = (0 to 8).reverse.map(_ * 1.0).toList)
        )
      ),
    )
    invalid.foreach(value =>
      assert(SeriesPlayerRadarCodec.command(request.copy(manualInput = Some(value))).isLeft)
    )

  test("manual wire commands require explicit nullable concurrency fields"):
    val missing = """{"gameTitleId":"title","kind":"manual"}"""
    val explicit =
      """{"gameTitleId":"title","kind":"manual","expectedCurrentBasisId":null,"expectedCandidateId":null}"""
    assert(decode[SeriesPlayerRadarOperationRequest](missing).isLeft)
    assert(decode[SeriesPlayerRadarOperationRequest](explicit).isRight)
