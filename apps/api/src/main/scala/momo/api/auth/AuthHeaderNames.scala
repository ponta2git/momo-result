package momo.api.auth

object AuthHeaderNames:
  val AccountId: String = "X-Momo-Account-Id"
  val CsrfToken: String = "X-CSRF-Token"
  val RequestId: String = "X-Request-Id"
  val IdempotencyKey: String = "Idempotency-Key"
end AuthHeaderNames
