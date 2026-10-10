package momo.api.adapters.postgres

import cats.syntax.all.*
import io.circe.Json

import momo.api.domain.SeriesAnalysisChunkProjection
import momo.api.errors.AppError

/** Selects stored evidence only; missing evidence for an admitted window is corruption. */
private[postgres] object PostgresSeriesAnalysisOutlookProjection:
  def apply(
      chunk: DecodedSeriesAnalysisChunk,
      projection: SeriesAnalysisChunkProjection,
  ): Either[AppError, DecodedSeriesAnalysisChunk] = projection match
    case SeriesAnalysisChunkProjection.Stored => chunk.asRight
    case _ =>
      val error = AppError.Internal("Invalid outlook reference projection.")
      for
        fields <- List("schemaVersion", "scope", "source", "memberId").traverse(name =>
          chunk.payload.hcursor.downField(name).focus.map(name -> _).toRight(error)
        )
        selected <- projection match
          case SeriesAnalysisChunkProjection.OutlookExamples =>
            chunk.payload.hcursor.downField("examples").focus
              .map(value => Json.obj((fields :+ ("examples" -> value))*))
              .toRight(error)
          case SeriesAnalysisChunkProjection.OutlookWindow(size) =>
            for
              count <- chunk.payload.hcursor.downField("source").get[Int]("titleMatchCount")
                .leftMap(_ => error)
              windows <- chunk.payload.hcursor.get[Vector[Json]]("bestWindows").leftMap(_ => error)
              window <- if size > count then Option.empty[Json].asRight[AppError]
              else
                windows.find(_.hcursor.get[Int]("windowSize").contains(size))
                  .toRight(error).map(Some(_))
            yield Json.obj((fields ++ List(
              "windowSize" -> Json.fromInt(size),
              "status" -> Json.fromString(if window.isDefined then "available" else "insufficient"),
              "window" -> window.getOrElse(Json.Null),
            ))*)
          case SeriesAnalysisChunkProjection.Stored => chunk.payload.asRight[AppError]
      yield chunk.copy(
        payload = selected,
        nodeCount = PostgresSeriesAnalysisChunkCodec.jsonNodeCount(selected)
      )
