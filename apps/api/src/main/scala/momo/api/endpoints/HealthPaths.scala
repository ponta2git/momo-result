package momo.api.endpoints

object HealthPaths:
  val Health: String = "healthz"
  val Details: String = "details"

  val HealthPath: String = s"/$Health"
  val DetailsPath: String = s"/$Health/$Details"
end HealthPaths
