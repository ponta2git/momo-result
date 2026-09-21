package momo.api.repositories

import momo.api.domain.OcrSubmission
import momo.api.domain.ids.AccountId
import momo.api.errors.AppError

trait OcrSubmissionsRepository[F[_]]:
  def put(submission: OcrSubmission): F[Either[AppError, OcrSubmission]]
  def find(id: String, owner: AccountId): F[Option[OcrSubmission]]

  /** Only an authenticated upload whose bytes match the immutable member may close admission. */
  def failAdmission(owner: AccountId, keyHash: String, sha256: String, byteLength: Int): F[Unit]
