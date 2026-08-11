package momo.api.domain

enum ScreenType(val wire: String) derives CanEqual:
  case Auto extends ScreenType("auto")
  case TotalAssets extends ScreenType("total_assets")
  case Revenue extends ScreenType("revenue")
  case IncidentLog extends ScreenType("incident_log")

object ScreenType:
  def fromWire(value: String): Option[ScreenType] = values.find(_.wire == value)

  /** New OCR requests must name the destination slot. Auto remains decode-only for v1 history. */
  def fromExplicitWire(value: String): Option[ScreenType] = fromWire(value)
    .filterNot(_ == ScreenType.Auto)
