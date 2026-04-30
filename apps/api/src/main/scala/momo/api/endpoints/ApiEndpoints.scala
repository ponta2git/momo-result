package momo.api.endpoints

import sttp.tapir.AnyEndpoint

object ApiEndpoints:
  val all: List[AnyEndpoint] = List(
    HealthEndpoints.health,
    OpenApiEndpoints.yaml,
    AuthEndpoints.me,
    UploadEndpoints.uploadImage,
    OcrJobEndpoints.create,
    OcrJobEndpoints.get,
    OcrJobEndpoints.cancel,
    OcrDraftEndpoints.get,
    OcrDraftEndpoints.listByIds,
    HeldEventsEndpoints.list,
    HeldEventsEndpoints.create,
    MatchesEndpoints.confirm,
    GameTitlesEndpoints.list,
    GameTitlesEndpoints.create,
    MapMastersEndpoints.list,
    MapMastersEndpoints.create,
    SeasonMastersEndpoints.list,
    SeasonMastersEndpoints.create,
    IncidentMastersEndpoints.list,
  )
