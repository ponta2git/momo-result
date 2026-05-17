package momo.api.endpoints.codec

import momo.api.domain.MatchExportFormat
import momo.api.errors.AppError

/** Query parameter conversions for `ExportEndpoints`. */
object ExportCodec:
  def parseFormat(value: String): Either[AppError, MatchExportFormat] = MatchExportFormat
    .fromWire(value).toRight(AppError.ValidationFailed("format must be one of: csv, tsv."))
end ExportCodec
