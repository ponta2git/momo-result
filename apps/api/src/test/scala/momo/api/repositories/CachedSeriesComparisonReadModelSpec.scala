package momo.api.repositories

import java.time.Instant

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.domain.ids.GameTitleId
import momo.api.domain.{
  SeriesComparisonMatchPlayerRow,
  SeriesComparisonOptionsData,
  SeriesComparisonResolvedScope,
  SeriesComparisonScope
}

final class CachedSeriesComparisonReadModelSpec extends MomoCatsEffectSuite:
  private val scope = SeriesComparisonResolvedScope(
    gameTitleId = GameTitleId.unsafeFromString("title_cache"),
    gameTitleName = "Cache",
    layoutFamily = "momotetsu2",
    scopeKind = "overall",
    scopeId = None,
    scopeName = "総合",
  )

  test("reuses rows while the scope data version is unchanged and reloads after it changes"):
    for
      version <- Ref.of[IO, SeriesComparisonDataVersion](
        SeriesComparisonDataVersion(1, Some(Instant.parse("2026-01-01T00:00:00Z")))
      )
      loadCalls <- Ref.of[IO, Int](0)
      delegate = new StaticVersionedReadModel(version, loadCalls)
      cached <- CachedSeriesComparisonReadModel.create[IO](delegate, maxEntries = 4)
      _ <- cached.loadRows(scope)
      _ <- cached.loadRows(scope)
      firstCallCount <- loadCalls.get
      _ <- version.set(SeriesComparisonDataVersion(
        2,
        Some(Instant.parse("2026-01-01T00:01:00Z")),
      ))
      _ <- cached.loadRows(scope)
      secondCallCount <- loadCalls.get
    yield
      assertEquals(firstCallCount, 1)
      assertEquals(secondCallCount, 2)

  private final class StaticVersionedReadModel(
      version: Ref[IO, SeriesComparisonDataVersion],
      loadCalls: Ref[IO, Int],
  ) extends VersionedSeriesComparisonReadModel[IO]:
    override def options: IO[SeriesComparisonOptionsData] = IO
      .pure(SeriesComparisonOptionsData(None, Nil))

    override def resolveScope(
        requestScope: SeriesComparisonScope
    ): IO[Option[SeriesComparisonResolvedScope]] = IO.pure(Some(scope))

    override def loadRows(
        requestScope: SeriesComparisonResolvedScope
    ): IO[List[SeriesComparisonMatchPlayerRow]] = loadCalls.update(_ + 1).as(Nil)

    override def dataVersion(
        requestScope: SeriesComparisonResolvedScope
    ): IO[SeriesComparisonDataVersion] = version.get
