package momo.api.endpoints

object UploadPaths:
  val Api: String = "api"
  val Uploads: String = "uploads"
  val Images: String = "images"

  val ImageUploadPath: String = s"/$Api/$Uploads/$Images"
end UploadPaths
