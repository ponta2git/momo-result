package momo.api.domain

enum ScreenType(val wire: String):
  case Auto extends ScreenType("auto")
  case TotalAssets extends ScreenType("total_assets")
  case Revenue extends ScreenType("revenue")
  case IncidentLog extends ScreenType("incident_log")

object ScreenType:
  def fromWire(value: String): Option[ScreenType] =
    values.find(_.wire == value)
