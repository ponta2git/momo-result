//! Canonical storage allocation. Existing references are resolved through persisted aliases.
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
pub(crate) mod fixtures;
pub(crate) mod schema;

const NAMESPACE: Uuid = Uuid::from_u128(0xdeab_c659_a5ca_4dc0_9711_eae0_614f_a478);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Entity {
    Members,
    MemberAliases,
    Accounts,
    Sessions,
    Responses,
    HeldEvents,
    GameTitles,
    MapMasters,
    SeasonMasters,
    IncidentMasters,
    Matches,
    MatchDrafts,
    SourceImages,
    OcrJobs,
    OcrDrafts,
    OcrSubmissions,
    AnalysisOperations,
    AnalysisCampaigns,
    AnalysisRequests,
    AnalysisJobs,
    AnalysisAttempts,
    AnalysisArtifacts,
    RadarBases,
    RadarCandidates,
    RadarOperations,
    RadarPreviews,
}

impl Entity {
    pub(crate) const ALL: [Self; 26] = [
        Self::Members,
        Self::MemberAliases,
        Self::Accounts,
        Self::Sessions,
        Self::Responses,
        Self::HeldEvents,
        Self::GameTitles,
        Self::MapMasters,
        Self::SeasonMasters,
        Self::IncidentMasters,
        Self::Matches,
        Self::MatchDrafts,
        Self::SourceImages,
        Self::OcrJobs,
        Self::OcrDrafts,
        Self::OcrSubmissions,
        Self::AnalysisOperations,
        Self::AnalysisCampaigns,
        Self::AnalysisRequests,
        Self::AnalysisJobs,
        Self::AnalysisAttempts,
        Self::AnalysisArtifacts,
        Self::RadarBases,
        Self::RadarCandidates,
        Self::RadarOperations,
        Self::RadarPreviews,
    ];

    pub(crate) const fn namespace(self) -> &'static str {
        match self {
            Self::Members => "members",
            Self::MemberAliases => "member_aliases",
            Self::Accounts => "momo_login_accounts",
            Self::Sessions => "sessions",
            Self::Responses => "responses",
            Self::HeldEvents => "held_events",
            Self::GameTitles => "game_titles",
            Self::MapMasters => "map_masters",
            Self::SeasonMasters => "season_masters",
            Self::IncidentMasters => "incident_masters",
            Self::Matches => "matches",
            Self::MatchDrafts => "match_drafts",
            Self::SourceImages => "source_images",
            Self::OcrJobs => "ocr_jobs",
            Self::OcrDrafts => "ocr_drafts",
            Self::OcrSubmissions => "ocr_submissions",
            Self::AnalysisOperations => "series_analysis_operation_requests",
            Self::AnalysisCampaigns => "series_analysis_campaigns",
            Self::AnalysisRequests => "series_analysis_job_requests",
            Self::AnalysisJobs => "series_analysis_jobs",
            Self::AnalysisAttempts => "series_analysis_job_attempts",
            Self::AnalysisArtifacts => "series_analysis_artifacts",
            Self::RadarBases => "series_radar_bases",
            Self::RadarCandidates => "series_radar_candidates",
            Self::RadarOperations => "series_radar_operations",
            Self::RadarPreviews => "series_radar_previews",
        }
    }

    pub(crate) const fn identity_table(self) -> &'static str {
        match self {
            Self::AnalysisArtifacts => "series_analysis_artifact_identities",
            Self::RadarBases => "series_radar_basis_identities",
            Self::Members
            | Self::MemberAliases
            | Self::Accounts
            | Self::Sessions
            | Self::Responses
            | Self::HeldEvents
            | Self::GameTitles
            | Self::MapMasters
            | Self::SeasonMasters
            | Self::IncidentMasters
            | Self::Matches
            | Self::MatchDrafts
            | Self::SourceImages
            | Self::OcrJobs
            | Self::OcrDrafts
            | Self::OcrSubmissions
            | Self::AnalysisOperations
            | Self::AnalysisCampaigns
            | Self::AnalysisRequests
            | Self::AnalysisJobs
            | Self::AnalysisAttempts
            | Self::RadarCandidates
            | Self::RadarOperations
            | Self::RadarPreviews => self.namespace(),
        }
    }
}

#[derive(Debug, Error)]
#[error("canonical identity allocation rejected invalid encoding")]
pub(crate) struct InvalidIdentity;

/// Allocate a trusted structured job/attempt or retained identity. This is never a lookup fallback.
pub(crate) fn allocate(entity: Entity, legacy: &str) -> Result<Uuid, InvalidIdentity> {
    if legacy.contains('\0') {
        return Err(InvalidIdentity);
    }
    if let Some(existing) = parse_postgres_uuid(legacy) {
        return Ok(existing);
    }
    let mut hash = Sha256::new();
    hash.update(NAMESPACE.as_bytes());
    hash.update(entity.namespace().as_bytes());
    hash.update([0]);
    hash.update(legacy.as_bytes());
    uuid8(hash)
}

fn uuid8(hash: Sha256) -> Result<Uuid, InvalidIdentity> {
    let mut bytes = [0_u8; 16];
    for (target, source) in bytes.iter_mut().zip(hash.finalize()) {
        *target = source;
    }
    let version = bytes.get_mut(6).ok_or(InvalidIdentity)?;
    *version = (*version & 0x0f) | 0x80;
    let variant = bytes.get_mut(8).ok_or(InvalidIdentity)?;
    *variant = (*variant & 0x3f) | 0x80;
    Ok(Uuid::from_bytes(bytes))
}

/// PostgreSQL permits omitted hyphens and hyphens after any group of four hex digits.
fn parse_postgres_uuid(value: &str) -> Option<Uuid> {
    let value = if let Some(inner) = value.strip_prefix('{') {
        inner.strip_suffix('}')?
    } else {
        value
    };
    if value.split('-').any(|part| {
        part.is_empty() || part.len() % 4 != 0 || !part.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return None;
    }
    let compact: String = value
        .chars()
        .filter(|character| *character != '-')
        .collect();
    (compact.len() == 32)
        .then(|| Uuid::parse_str(&compact).ok())
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        algorithm: String,
        namespace: Uuid,
        entity_namespaces: Vec<String>,
        rfc_vector: RfcVector,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct RfcVector {
        namespace: Uuid,
        name: String,
        expected: Uuid,
    }

    #[derive(Deserialize)]
    struct Case {
        entity: String,
        legacy: String,
        canonical: Uuid,
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "shared identity fixtures are asserted against independently fixed vectors"
    )]
    fn allocation_matches_all_shared_and_independent_rfc_vectors()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../docs/schemas/fixtures/identity/canonical-identities-v1.json"
        ))?;
        assert_eq!(fixture.algorithm, "sha256-uuidv8-v1");
        assert_eq!(fixture.namespace, NAMESPACE);
        assert_eq!(
            fixture.entity_namespaces,
            Entity::ALL.map(Entity::namespace)
        );
        for case in fixture.cases {
            let entity = Entity::ALL
                .into_iter()
                .find(|entity| entity.namespace() == case.entity)
                .ok_or("unknown fixture namespace")?;
            assert_eq!(allocate(entity, &case.legacy)?, case.canonical);
        }
        let mut hash = Sha256::new();
        hash.update(fixture.rfc_vector.namespace.as_bytes());
        hash.update(fixture.rfc_vector.name.as_bytes());
        assert_eq!(uuid8(hash)?, fixture.rfc_vector.expected);
        assert!(allocate(Entity::Members, "bad\0identity").is_err());
        for invalid in [
            "{00112233-4455-6677-8899-aabbccddeeff",
            " 00112233-4455-6677-8899-aabbccddeeff",
            "00112233-4455-6677-8899-aabbccddeeff\n",
            "0011223-34455-6677-8899-aabbccddeeff",
        ] {
            assert!(parse_postgres_uuid(invalid).is_none());
        }
        Ok(())
    }
}
