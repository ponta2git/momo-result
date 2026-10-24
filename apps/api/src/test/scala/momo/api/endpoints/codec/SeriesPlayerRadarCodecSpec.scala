package momo.api.endpoints.codec

import io.circe.parser.decode
import munit.FunSuite

import momo.api.endpoints.{
  SeriesPlayerRadarAchievementCurveRequest,
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

  test("achievement percentages preserve the five submitted boundaries and reject invalid curves"):
    val custom = List(0.0, 20.0, 40.0, 60.0, 100.0)
    def withCurve(values: List[Double]) = request.copy(manualInput =
      Some(input.copy(
        achievementCurve = Some(SeriesPlayerRadarAchievementCurveRequest(values))
      ))
    )
    assertEquals(
      SeriesPlayerRadarCodec.command(withCurve(custom))
        .toOption.flatMap(_.manualInput).flatMap(_.achievementCurve).map(_.thresholds),
      Some(custom)
    )
    List(
      custom.tail,
      custom :+ 100.0,
      List(-1.0, 20.0, 40.0, 60.0, 100.0),
      List(0.0, 20.0, 40.0, 60.0, 101.0),
      List(0.0, 20.0, 20.0, 60.0, 100.0),
      custom.reverse,
      List(0.0, 20.0, Double.NaN, 60.0, 100.0),
      List(0.0, 20.0, 40.0, 60.0, Double.PositiveInfinity),
    ).foreach(values => assert(SeriesPlayerRadarCodec.command(withCurve(values)).isLeft))

  test("withdraw optionally carries a creation operation while still requiring its candidate"):
    val guarded = request.copy(
      kind = "withdraw",
      candidateId = Some("candidate"),
      originOperationId = Some("manual-creation"),
      sourceBasisId = None,
      manualInput = None
    )
    assertEquals(
      SeriesPlayerRadarCodec.command(guarded).map(_.originOperationId),
      Right(Some("manual-creation"))
    )
    assert(SeriesPlayerRadarCodec.command(guarded.copy(candidateId = None)).isLeft)
    assert(SeriesPlayerRadarCodec.command(guarded.copy(originOperationId = None)).isRight)
