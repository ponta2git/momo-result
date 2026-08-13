package momo.api.endpoints

object AuthPaths:
  val Api: String = "api"
  val Auth: String = "auth"

  val Login: String = "login"
  val Callback: String = "callback"
  val Logout: String = "logout"
  val Me: String = "me"

  val SilentQuery: String = "silent"
  val NextQuery: String = "next"
  val CodeQuery: String = "code"
  val StateQuery: String = "state"
  val ErrorQuery: String = "error"

  val LoginPath: String = s"/$Api/$Auth/$Login"
end AuthPaths
