package momo.api.bootstrap

import java.time.Instant

import cats.syntax.all.*
import cats.{Monad, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.ids.*
import momo.api.http.modules.{OcrModule, UploadModule}
import momo.api.ports.storage.ImageStorage
import momo.api.repositories.*
import momo.api.usecases.images.{ImageStorageAdmission, UploadImage}
import momo.api.usecases.ocr.*

private[bootstrap] object OcrUseCaseWiring:
  def upload[F[_]: Monad](
      images: ImageStorage[F],
      admission: ImageStorageAdmission[F],
      submissions: OcrSubmissions[F],
  ): UploadModule.UseCases[F] =
    UploadModule.UseCases(UploadImage[F](images, admission), submissions)

  def jobs[F[_]: MonadThrow: LoggerFactory](
      images: ImageStorage[F],
      creation: OcrJobCreationStore[F],
      submissionRepository: OcrSubmissionsRepository[F],
      submissions: OcrSubmissions[F],
      jobs: OcrJobsRepository[F],
      drafts: OcrDraftsRepository[F],
      matchDrafts: MatchDraftsRepository[F],
      aliases: MemberAliasesRepository[F],
      admission: OcrAdmissionGuard[F],
      activeJobLimit: Int,
      now: F[Instant],
      nextJobId: F[OcrJobId],
      nextDraftId: F[OcrDraftId],
  ): OcrModule.UseCases[F] = OcrModule.UseCases(
    createOcrJob = CreateOcrJob[F](
      imageStore = images,
      creationStore = creation,
      submissions = submissionRepository,
      jobs = jobs,
      matchDrafts = matchDrafts,
      admissionGuard = admission,
      now = now,
      nextJobId = nextJobId,
      nextDraftId = nextDraftId,
      aliasSnapshot = aliases.list(None).map(_.groupMap(_.memberId)(_.alias)),
      activeJobLimit = activeJobLimit,
    ),
    submissions = submissions,
    getOcrJob = GetOcrJob[F](jobs),
    getOcrDraft = GetOcrDraft[F](drafts),
    getOcrDraftsBulk = GetOcrDraftsBulk[F](drafts),
    cancelOcrJob = CancelOcrJob[F](jobs, now),
  )
