package momo.api.usecases.exports

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.{MatchExportFile, MatchExportFormat, MatchExportRow, MatchExportScope}
import momo.api.errors.AppError
import momo.api.repositories.MatchExportsRepository

final class ExportMatches[F[_]: Functor](
    matchExports: MatchExportsRepository[F],
    limits: ExportMatches.Limits,
):
  def run(
      format: MatchExportFormat,
      scope: MatchExportScope,
  ): F[Either[AppError, MatchExportFile]] = matchExports.project(scopeToSelection(scope)).map {
    rows =>
      scope match
        case MatchExportScope.Match(id) if rows.isEmpty =>
          Left(AppError.NotFound("match", id.value))
        case _ => render(format, scope, rows)
  }

  private def render(
      format: MatchExportFormat,
      scope: MatchExportScope,
      rows: List[MatchExportRow],
  ): Either[AppError, MatchExportFile] =
    if rows.length > limits.maxRows then
      Left(AppError.PayloadTooLarge(
        s"Match export has ${rows.length} rows, exceeding the configured limit of ${limits.maxRows} rows. Narrow the export scope."
      ))
    else
      MatchExportRenderer.render(format, rows, limits.maxBytes)
        .toRight(AppError.PayloadTooLarge(
          s"Match export exceeds the configured limit of ${limits.maxBytes} bytes. Narrow the export scope."
        )).map(rendered =>
          MatchExportFile(
            fileName = s"momo-results-${scope.filePart}.${format.extension}",
            contentType = format.contentType,
            body = rendered.body,
            sizeBytes = rendered.sizeBytes,
          )
        )

  private def scopeToSelection(scope: MatchExportScope): MatchExportsRepository.Selection =
    val limit = ((limits.maxRows + 3) / 4) + 1
    scope match
      case MatchExportScope.All => MatchExportsRepository.Selection(limit = limit)
      case MatchExportScope.Season(id) =>
        MatchExportsRepository.Selection(seasonMasterId = Some(id), limit = limit)
      case MatchExportScope.HeldEvent(id) =>
        MatchExportsRepository.Selection(heldEventId = Some(id), limit = limit)
      case MatchExportScope.Match(id) =>
        MatchExportsRepository.Selection(matchId = Some(id), limit = limit)

object ExportMatches:
  final case class Limits(maxRows: Int, maxBytes: Long)
