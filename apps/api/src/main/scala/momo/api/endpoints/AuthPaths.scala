package momo.api.endpoints

object AuthPaths:
  val Api: String = "api"
  val Auth: String = "auth"

  val Login: String = "login"
  val Callback: String = "callback"
  val Logout: String = "logout"
  val Me: String = "me"

  val LoginPath: String = s"/$Api/$Auth/$Login"
  val CallbackPath: String = s"/$Api/$Auth/$Callback"
  val LogoutPath: String = s"/$Api/$Auth/$Logout"
  val MePath: String = s"/$Api/$Auth/$Me"
end AuthPaths
