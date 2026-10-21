package momo.api.adapters.postgres

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

/** Frozen storage allocation. Existing references must be looked up, never inferred from a hash. */
private[postgres] object CanonicalIdentity:
  enum Entity(val table: String, val identityTable: String) derives CanEqual:
    case Members extends Entity("members", "members")
    case MemberAliases extends Entity("member_aliases", "member_aliases")
    case Accounts extends Entity("momo_login_accounts", "momo_login_accounts")
    case Sessions extends Entity("sessions", "sessions")
    case Responses extends Entity("responses", "responses")
    case HeldEvents extends Entity("held_events", "held_events")
    case GameTitles extends Entity("game_titles", "game_titles")
    case MapMasters extends Entity("map_masters", "map_masters")
    case SeasonMasters extends Entity("season_masters", "season_masters")
    case IncidentMasters extends Entity("incident_masters", "incident_masters")
    case Matches extends Entity("matches", "matches")
    case MatchDrafts extends Entity("match_drafts", "match_drafts")
    case SourceImages extends Entity("source_images", "source_images")
    case OcrJobs extends Entity("ocr_jobs", "ocr_jobs")
    case OcrDrafts extends Entity("ocr_drafts", "ocr_drafts")
    case OcrSubmissions extends Entity("ocr_submissions", "ocr_submissions")
    case AnalysisOperations
        extends Entity("series_analysis_operation_requests", "series_analysis_operation_requests")
    case AnalysisCampaigns extends Entity("series_analysis_campaigns", "series_analysis_campaigns")
    case AnalysisRequests
        extends Entity("series_analysis_job_requests", "series_analysis_job_requests")
    case AnalysisJobs extends Entity("series_analysis_jobs", "series_analysis_jobs")
    case AnalysisAttempts
        extends Entity("series_analysis_job_attempts", "series_analysis_job_attempts")
    case AnalysisArtifacts
        extends Entity("series_analysis_artifacts", "series_analysis_artifact_identities")
    case RadarBases extends Entity("series_radar_bases", "series_radar_basis_identities")
    case RadarCandidates extends Entity("series_radar_candidates", "series_radar_candidates")
    case RadarOperations extends Entity("series_radar_operations", "series_radar_operations")
    case RadarPreviews extends Entity("series_radar_previews", "series_radar_previews")

  val Namespace: UUID = UUID.fromString("deabc659-a5ca-4dc0-9711-eae0614fa478")
  private val HexGroups = "[0-9a-fA-F]{4}(?:-?[0-9a-fA-F]{4}){7}"
  val UuidPattern: String = s"^(?:$HexGroups|\\{$HexGroups\\})$$"
  private val AcceptedUuid = UuidPattern.r

  /** PostgreSQL's accepted spellings, without Java UUID.fromString's short-group extension. */
  def uuid(value: String): Option[UUID] = Option.when(AcceptedUuid.matches(value)) {
    val hex = value.replace("{", "").replace("}", "").replace("-", "")
    UUID.fromString(
      s"${hex.take(8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.drop(20)}"
    )
  }

  def structured(entity: Entity, legacy: String): Either[String, UUID] =
    if legacy.indexOf('\u0000') >= 0 || !StandardCharsets.UTF_8.newEncoder().canEncode(legacy) then
      Left("Invalid legacy identity encoding.")
    else
      Right(uuid(legacy).getOrElse {
        val name = (entity.table + "\u0000" + legacy).getBytes(StandardCharsets.UTF_8)
        nameBasedUuid8(Namespace, name)
      })

  private[postgres] def nameBasedUuid8(namespace: UUID, name: Array[Byte]): UUID =
    val prefix = ByteBuffer.allocate(16).putLong(namespace.getMostSignificantBits)
      .putLong(namespace.getLeastSignificantBits).array()
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(prefix)
    val bytes = digest.digest(name).take(16)
    bytes(6) = ((bytes(6) & 0x0f) | 0x80).toByte
    bytes(8) = ((bytes(8) & 0x3f) | 0x80).toByte
    val buffer = ByteBuffer.wrap(bytes)
    UUID(buffer.getLong(), buffer.getLong())
