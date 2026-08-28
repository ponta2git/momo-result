package momo.api.adapters.inmemory

import momo.api.errors.AppError

private[adapters] def masterConflict(message: String): AppError = AppError.Conflict(message)

private[adapters] def notFound(resource: String, id: String): AppError =
  AppError.NotFound(resource, id)
