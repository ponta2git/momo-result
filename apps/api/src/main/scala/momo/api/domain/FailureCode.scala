package momo.api.domain

enum FailureCode(val wire: String, val retryable: Boolean):
  case TempImageMissing extends FailureCode("TEMP_IMAGE_MISSING", false)
  case InvalidImage extends FailureCode("INVALID_IMAGE", false)
  case UnsupportedImageFormat extends FailureCode("UNSUPPORTED_IMAGE_FORMAT", false)
  case ImageTooLarge extends FailureCode("IMAGE_TOO_LARGE", false)
  case DecodeFailed extends FailureCode("DECODE_FAILED", false)
  case CategoryUndetected extends FailureCode("CATEGORY_UNDETECTED", false)
  case LayoutUnsupported extends FailureCode("LAYOUT_UNSUPPORTED", false)
  case OcrTimeout extends FailureCode("OCR_TIMEOUT", true)
  case OcrEngineUnavailable extends FailureCode("OCR_ENGINE_UNAVAILABLE", true)
  case ParserFailed extends FailureCode("PARSER_FAILED", false)
  case DbWriteFailed extends FailureCode("DB_WRITE_FAILED", true)
  case QueueFailure extends FailureCode("QUEUE_FAILURE", false)

object FailureCode:
  def fromWire(value: String): Option[FailureCode] =
    values.find(_.wire == value)
