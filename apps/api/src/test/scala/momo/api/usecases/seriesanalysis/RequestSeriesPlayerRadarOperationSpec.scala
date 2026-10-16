package momo.api.usecases.seriesanalysis

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.SeriesPlayerRadarRepository

final class RequestSeriesPlayerRadarOperationSpec extends MomoCatsEffectSuite:
  private val title = GameTitleId.unsafeFromString("title")
  private val owner = AccountId.unsafeFromString("owner")
  private val axes = List(
    "averageRank",
    "revenueP90",
    "revenueAverage",
    "totalAssetsP10",
    "totalAssetsMedian",
    "totalAssetsP90"
  ).map { id =>
    SeriesPlayerRadarManualAxis(
      id,
      if id == "averageRank" then (1 to 9).reverse.map(_.toDouble).toList
      else (-4 to 4).map(value => if value == 0 then -0.0 else value.toDouble).toList
    )
  }
  private val command = SeriesPlayerRadarCommand(
    title,
    SeriesPlayerRadarOperationKind.Manual,
    None,
    None,
    None,
    None,
    None,
    sourceBasisId = Some("source"),
    manualInput = Some(SeriesPlayerRadarManualInput(axes))
  )
  private val response = Left(AppError.NotFound("operation", "fixture"))

  private class Repository(calls: Ref[IO, List[(SeriesPlayerRadarCommand, String, String)]])
      extends SeriesPlayerRadarRepository[IO]:
    def radarState(id: GameTitleId): IO[Either[AppError, SeriesPlayerRadarDocument]] =
      IO.pure(response)
    def radarHistory(request: SeriesPlayerRadarHistoryRequest)
        : IO[Either[AppError, SeriesPlayerRadarDocument]] = IO.pure(response)
    def radarRevision(id: String): IO[Either[AppError, SeriesPlayerRadarDocument]] =
      IO.pure(response)
    def radarPreview(request: SeriesPlayerRadarPreviewRequest)
        : IO[Either[AppError, SeriesPlayerRadarDocument]] = IO.pure(response)
    def radarOperation(
        id: GameTitleId,
        operation: String
    ): IO[Either[AppError, SeriesPlayerRadarOperation]] = IO.pure(response)
    def requestRadarOperation(
        value: SeriesPlayerRadarCommand,
        by: AccountId,
        key: String,
        fingerprint: String
    )
        : IO[Either[AppError, SeriesPlayerRadarOperation]] =
      calls.update(_ :+ ((value, key, fingerprint))).as(response)

  test("direct usecase entry validates kind fields and manual boundaries before persistence") {
    for
      calls <- Ref.of[IO, List[(SeriesPlayerRadarCommand, String, String)]](Nil)
      service = RequestSeriesPlayerRadarOperation[IO](new Repository(calls))
      invalidFields <- service.run(command.copy(sourceBasisId = None), owner, "key")
      invalidAxes <- service.run(
        command.copy(manualInput = Some(SeriesPlayerRadarManualInput(axes.reverse))),
        owner,
        "key"
      )
      recorded <- calls.get
    yield
      assertEquals(invalidFields.left.toOption.map(_.code), Some("VALIDATION_FAILED"))
      assertEquals(invalidAxes.left.toOption.map(_.code), Some("VALIDATION_FAILED"))
      assertEquals(recorded, Nil)
  }

  test("manual request fingerprints preserve persisted encoding and canonicalize negative zero") {
    for
      calls <- Ref.of[IO, List[(SeriesPlayerRadarCommand, String, String)]](Nil)
      service = RequestSeriesPlayerRadarOperation[IO](new Repository(calls))
      _ <- service.run(command, owner, "key")
      normalized = command.copy(manualInput =
        command.manualInput.map(input =>
          input.copy(axes =
            input.axes.map(axis =>
              axis.copy(thresholds =
                axis.thresholds.map(value => if value == 0 then 0.0 else value)
              )
            )
          )
        )
      )
      _ <- service.run(normalized, owner, "key")
      recorded <- calls.get
    yield
      assertEquals(recorded.size, 2)
      assertEquals(recorded.head, recorded.last)
      assertEquals(
        recorded.head._2,
        "2c70e12b7a0646f92279f427c7b38e7334d8e5389cff167a1dc30e73f826b683"
      )
      assertEquals(
        recorded.head._3,
        "0719d0df18bb166b05d15f73220590ffaa97f3c91ff59bbc95e561f5bf432bf8"
      )
      assertEquals(
        java.lang.Double.doubleToRawLongBits(
          recorded.head._1.manualInput.get.axes(1).thresholds(4)
        ),
        0L
      )
  }
