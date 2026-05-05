package momo.api.http.modules

import cats.effect.Async
import cats.syntax.all.*
import sttp.tapir.server.ServerEndpoint

import momo.api.domain.ids.{HeldEventId, MatchId, SeasonMasterId}
import momo.api.endpoints.ExportEndpoints
import momo.api.http.EndpointSecurity
import momo.api.usecases.ExportMatches

object ExportModule:
  def routes[F[_]: Async](
      exportMatches: ExportMatches[F],
      security: EndpointSecurity[F],
  ): List[ServerEndpoint[Any, F]] = List(
    ExportEndpoints.matches.serverLogic {
      case (format, seasonMasterId, heldEventId, matchId, devUser) => security
          .authorizeRead(devUser) { _ =>
            exportMatches.run(
              format,
              seasonMasterId.map(SeasonMasterId(_)),
              heldEventId.map(HeldEventId(_)),
              matchId.map(MatchId(_)),
            ).map(_.leftMap(security.toProblem).map(file =>
              (file.contentDisposition, file.contentType, file.body)
            ))
          }
    }
  )
