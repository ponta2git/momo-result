package momo.api.http

import momo.api.errors.AppError

private[http] object HttpIncidentPolicy:
  def shouldLog(error: AppError): Boolean = error match
    case _: AppError.DependencyFailed => true
    case _: AppError.Internal => true
    case _ => false
