package momo.api.http

import munit.FunSuite

import momo.api.errors.AppError

final class HttpIncidentPolicySpec extends FunSuite:
  test("logs only dependency and internal application errors as incidents"):
    assert(HttpIncidentPolicy.shouldLog(AppError.DependencyFailed("database failed")))
    assert(HttpIncidentPolicy.shouldLog(AppError.Internal("stored response failed")))
    assert(!HttpIncidentPolicy.shouldLog(AppError.Conflict("already exists")))
    assert(!HttpIncidentPolicy.shouldLog(AppError.ValidationFailed("invalid payload")))
