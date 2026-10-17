package momo.api.config

enum MaintenanceMode derives CanEqual:
  case Normal, Frozen

object MaintenanceMode:
  def parse(value: Option[String]): Either[IllegalArgumentException, MaintenanceMode] = value match
    case None | Some("normal") => Right(MaintenanceMode.Normal)
    case Some("frozen") => Right(MaintenanceMode.Frozen)
    case _ => Left(new IllegalArgumentException(
        "MOMO_MAINTENANCE_MODE must be normal or frozen."
      ))
