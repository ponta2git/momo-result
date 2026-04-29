package momo.api.http

import cats.effect.Async
import cats.effect.Resource
import cats.syntax.all.*
import momo.api.adapters.InMemoryOcrDraftsRepository
import momo.api.adapters.InMemoryOcrJobsRepository
import momo.api.adapters.InMemoryQueueProducer
import momo.api.adapters.LocalFsImageStore
import momo.api.auth.MemberRoster
import momo.api.config.AppConfig
import momo.api.domain.IdGenerator
import momo.api.domain.ids.*
import momo.api.endpoints.AuthEndpoints
import momo.api.endpoints.AuthMeResponse
import momo.api.endpoints.HealthEndpoints
import momo.api.endpoints.OcrDraftEndpoints
import momo.api.endpoints.OcrDraftResponse
import momo.api.endpoints.OcrJobEndpoints
import momo.api.endpoints.OcrJobResponse
import momo.api.endpoints.CancelOcrJobResponse
import momo.api.endpoints.CreateOcrJobResponse
import momo.api.endpoints.OpenApiEndpoints
import momo.api.endpoints.UploadEndpoints
import momo.api.endpoints.UploadImageResponse
import momo.api.errors.AppError
import momo.api.openapi.OpenApiGenerator
import momo.api.usecases.CancelOcrJob
import momo.api.usecases.CreateOcrJob
import momo.api.usecases.CreateOcrJobCommand
import momo.api.usecases.GetOcrDraft
import momo.api.usecases.GetOcrJob
import momo.api.usecases.UploadImage
import org.http4s.HttpApp as Http4sApp
import org.http4s.server.Router
import sttp.model.Part
import sttp.tapir.server.ServerEndpoint
import sttp.tapir.server.http4s.Http4sServerInterpreter

import java.time.Instant

object HttpApp:
  def resource[F[_]: Async](config: AppConfig): Resource[F, Http4sApp[F]] =
    Resource.eval {
      for
        jobs <- InMemoryOcrJobsRepository.create[F]
        drafts <- InMemoryOcrDraftsRepository.create[F]
        queue <- InMemoryQueueProducer.create[F]
      yield
        val imageStore = LocalFsImageStore[F](config.imageTmpDir)
        val roster = MemberRoster.dev(config.devMemberIds)
        val uploadImage = UploadImage[F](imageStore)
        val createOcrJob = CreateOcrJob[F](
          imageStore = imageStore,
          jobs = jobs,
          drafts = drafts,
          queue = queue,
          now = Async[F].delay(Instant.now()),
          nextId = IdGenerator.uuidV7[F]
        )
        val getOcrJob = GetOcrJob[F](jobs)
        val getOcrDraft = GetOcrDraft[F](drafts)
        val cancelOcrJob = CancelOcrJob[F](jobs, Async[F].delay(Instant.now()))

        build(
          config = config,
          roster = roster,
          uploadImage = uploadImage,
          createOcrJob = createOcrJob,
          getOcrJob = getOcrJob,
          getOcrDraft = getOcrDraft,
          cancelOcrJob = cancelOcrJob
        )
    }

  private def build[F[_]: Async](
      config: AppConfig,
      roster: MemberRoster,
      uploadImage: UploadImage[F],
      createOcrJob: CreateOcrJob[F],
      getOcrJob: GetOcrJob[F],
      getOcrDraft: GetOcrDraft[F],
      cancelOcrJob: CancelOcrJob[F]
  ): Http4sApp[F] =
    def toProblem(error: AppError): ProblemDetails.ErrorInfo =
      ProblemDetails.from(error)

    def authenticate(
        devUser: Option[String]
    ): F[Either[ProblemDetails.ErrorInfo, momo.api.auth.AuthenticatedMember]] =
      devUser match
        case Some(value) =>
          DevAuthMiddleware.authenticate(config.appEnv, roster, value).map(_.leftMap(toProblem))
        case None =>
          Async[F].pure(Left(toProblem(AppError.Unauthorized())))

    def validateCsrf(token: Option[String]): F[Either[ProblemDetails.ErrorInfo, Unit]] =
      CsrfMiddleware.validate(config.appEnv, token).map(_.leftMap(toProblem))

    def authorizeMutation(devUser: Option[String], csrfToken: Option[String]) =
      for
        auth <- authenticate(devUser)
        csrf <- validateCsrf(csrfToken)
      yield for
        member <- auth
        _ <- csrf
      yield member

    def extractFile(
        parts: Seq[Part[Array[Byte]]]
    ): Either[AppError, (Option[String], Option[String], Array[Byte])] =
      parts
        .find(_.name == "file")
        .map(part => (part.fileName, part.contentType.map(_.toString), part.body))
        .toRight(AppError.ValidationFailed("Multipart field 'file' is required."))

    val healthRoutes = Http4sServerInterpreter[F]().toRoutes(
      List[ServerEndpoint[Any, F]](
        HealthEndpoints.health.serverLogicSuccess(_ =>
          Async[F].pure(HealthEndpoints.HealthResponse("ok"))
        ),
        OpenApiEndpoints.yaml.serverLogicSuccess(_ => Async[F].pure(OpenApiGenerator.yaml)),
        AuthEndpoints.me.serverLogic { devUser =>
          authenticate(devUser).map(
            _.map(member => AuthMeResponse(member.memberId.value, member.displayName))
          )
        },
        UploadEndpoints.uploadImage.serverLogic { case (devUser, csrfToken, parts) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              extractFile(parts) match
                case Left(error) => Async[F].pure(Left(toProblem(error)))
                case Right((fileName, contentType, bytes)) =>
                  uploadImage.run(fileName, contentType, bytes).map {
                    case Right(image) => Right(UploadImageResponse.from(image))
                    case Left(error)  => Left(toProblem(error))
                  }
          }
        },
        OcrJobEndpoints.create.serverLogic { case (devUser, csrfToken, request) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              createOcrJob
                .run(
                  CreateOcrJobCommand(
                    imageId = request.imageId,
                    requestedImageType = request.requestedImageType,
                    ocrHints = request.ocrHints.getOrElse(momo.api.domain.OcrJobHints())
                  )
                )
                .map {
                  case Right(created) =>
                    Right(
                      CreateOcrJobResponse(
                        jobId = created.job.id.value,
                        draftId = created.draft.id.value,
                        status = created.job.status.wire
                      )
                    )
                  case Left(error) => Left(toProblem(error))
                }
          }
        },
        OcrJobEndpoints.get.serverLogic { case (jobId, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              getOcrJob.run(jobId).map {
                case Right(job)  => Right(OcrJobResponse.from(job))
                case Left(error) => Left(toProblem(error))
              }
          }
        },
        OcrJobEndpoints.cancel.serverLogic { case (jobId, devUser, csrfToken) =>
          authorizeMutation(devUser, csrfToken).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              cancelOcrJob.run(jobId).map {
                case Right(_)    => Right(CancelOcrJobResponse(jobId, "cancelled"))
                case Left(error) => Left(toProblem(error))
              }
          }
        },
        OcrDraftEndpoints.get.serverLogic { case (draftId, devUser) =>
          authenticate(devUser).flatMap {
            case Left(error) => Async[F].pure(Left(error))
            case Right(_) =>
              getOcrDraft.run(draftId).map {
                case Right(draft) => Right(OcrDraftResponse.from(draft))
                case Left(error)  => Left(toProblem(error))
              }
          }
        }
      )
    )

    Router("/" -> healthRoutes).orNotFound
