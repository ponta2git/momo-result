use std::{cmp::Ordering, collections::HashSet, ffi::OsStr, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

use crate::canonical::{CanonicalError, FramedSha256};

pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
pub const MANIFEST_VERSION: u32 = 1;
pub const QUEUE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QueuePayload {
    pub schema_version: u32,
    pub job_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ArtifactManifest {
    pub manifest_version: u32,
    pub artifact_id: String,
    pub game_title_id: String,
    pub input_revision: String,
    pub algorithm_version: String,
    pub artifact_schema_version: u32,
    pub source_input_checksum: String,
    pub root_checksum: String,
    pub resources: Vec<ResourceManifest>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScopeRef {
    Overall,
    Season {
        #[serde(rename = "seasonMasterId")]
        season_master_id: String,
    },
    Map {
        #[serde(rename = "mapMasterId")]
        map_master_id: String,
    },
    SeasonMap {
        #[serde(rename = "seasonMasterId")]
        season_master_id: String,
        #[serde(rename = "mapMasterId")]
        map_master_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResourceManifest {
    Aggregate {
        #[serde(flatten)]
        common: CommonResource,
    },
    Review {
        #[serde(flatten)]
        common: CommonResource,
    },
    Drilldown {
        #[serde(flatten)]
        common: CommonResource,
        #[serde(rename = "memberId")]
        member_id: String,
        #[serde(rename = "metricId")]
        metric_id: String,
    },
    MatchContext {
        #[serde(flatten)]
        common: CommonResource,
        #[serde(rename = "matchId")]
        match_id: String,
        #[serde(rename = "sourceMatchRevision")]
        source_match_revision: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommonResource {
    pub scope: ScopeRef,
    pub item_key: String,
    pub path: String,
    pub encoded_bytes: u64,
    pub decoded_bytes: u64,
    pub item_count: u64,
    pub nesting_depth: u32,
    pub checksum: String,
}

#[derive(Debug, Error)]
pub enum ContractError {
    #[error("unsupported queue schema version")]
    UnsupportedQueueSchema,
    #[error("unsupported artifact or manifest schema version")]
    UnsupportedArtifactSchema,
    #[error("invalid opaque identifier: {0}")]
    InvalidIdentifier(String),
    #[error("invalid non-negative decimal: {0}")]
    InvalidDecimal(String),
    #[error("invalid checksum: {0}")]
    InvalidChecksum(String),
    #[error("artifact has no overall aggregate resource")]
    MissingOverallAggregate,
    #[error("artifact resources are not in canonical order")]
    ResourceOrder,
    #[error("duplicate resource identity or path")]
    DuplicateResource,
    #[error("unsafe resource path: {0}")]
    UnsafePath(String),
    #[error("artifact exceeds the configured chunk count")]
    ChunkCountExceeded,
    #[error("artifact chunk metadata is inconsistent")]
    InvalidChunkMetadata,
    #[error("artifact root checksum does not match its resources")]
    RootChecksumMismatch,
    #[error("canonicalization failed: {0}")]
    Canonical(#[from] CanonicalError),
}

impl QueuePayload {
    /// Validates the minimal, untrusted Redis delivery payload.
    ///
    /// # Errors
    ///
    /// Returns [`ContractError`] for an unsupported version or malformed job identifier.
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.schema_version != QUEUE_SCHEMA_VERSION {
            return Err(ContractError::UnsupportedQueueSchema);
        }
        validate_id(&self.job_id)
    }
}

impl ArtifactManifest {
    /// Validates manifest identity, ordering, configured bounds, and its semantic root checksum.
    ///
    /// # Errors
    ///
    /// Returns [`ContractError`] when the manifest is unsupported, unsafe, or inconsistent.
    pub fn validate(
        &self,
        maximum_chunk_count: u64,
        maximum_chunk_bytes: u64,
    ) -> Result<(), ContractError> {
        if self.manifest_version != MANIFEST_VERSION
            || self.artifact_schema_version != ARTIFACT_SCHEMA_VERSION
        {
            return Err(ContractError::UnsupportedArtifactSchema);
        }
        validate_id(&self.artifact_id)?;
        validate_id(&self.game_title_id)?;
        validate_decimal(&self.input_revision)?;
        validate_version(&self.algorithm_version)?;
        validate_checksum(&self.source_input_checksum)?;
        validate_checksum(&self.root_checksum)?;
        if u64::try_from(self.resources.len()).map_or(true, |count| count > maximum_chunk_count) {
            return Err(ContractError::ChunkCountExceeded);
        }

        let mut paths = HashSet::<&str>::new();
        let mut previous: Option<&ResourceManifest> = None;
        let mut has_overall_aggregate = false;
        for resource in &self.resources {
            resource.validate(maximum_chunk_bytes)?;
            if !paths.insert(resource.common().path.as_str()) {
                return Err(ContractError::DuplicateResource);
            }
            if let Some(previous_resource) = previous {
                match previous_resource.canonical_cmp(resource) {
                    Ordering::Less => {}
                    Ordering::Equal => return Err(ContractError::DuplicateResource),
                    Ordering::Greater => return Err(ContractError::ResourceOrder),
                }
            }
            if matches!(resource, ResourceManifest::Aggregate { common } if common.scope == ScopeRef::Overall)
            {
                has_overall_aggregate = true;
            }
            previous = Some(resource);
        }
        if !has_overall_aggregate {
            return Err(ContractError::MissingOverallAggregate);
        }
        if self.computed_root_checksum()? != self.root_checksum {
            return Err(ContractError::RootChecksumMismatch);
        }
        Ok(())
    }

    /// Computes the semantic checksum over ordered resource metadata.
    ///
    /// # Errors
    ///
    /// Returns [`ContractError`] when canonical root-entry serialization fails.
    pub fn computed_root_checksum(&self) -> Result<String, ContractError> {
        let mut digest = FramedSha256::new();
        let mut buffer = Vec::with_capacity(256);
        for resource in &self.resources {
            digest.update_serialized(&resource.root_entry(), &mut buffer)?;
        }
        Ok(digest.finalize())
    }
}

impl ResourceManifest {
    fn validate(&self, maximum_chunk_bytes: u64) -> Result<(), ContractError> {
        let common = self.common();
        common.scope.validate()?;
        if common.item_key.is_empty() || common.item_key.len() > 512 {
            return Err(ContractError::InvalidIdentifier(common.item_key.clone()));
        }
        if common.encoded_bytes < 2
            || common.encoded_bytes > maximum_chunk_bytes
            || common.decoded_bytes != common.encoded_bytes
            || common.decoded_bytes > maximum_chunk_bytes
            || !(1..=64).contains(&common.nesting_depth)
        {
            return Err(ContractError::InvalidChunkMetadata);
        }
        validate_checksum(&common.checksum)?;
        validate_file_name(&common.path)?;
        match self {
            Self::Drilldown {
                member_id,
                metric_id,
                ..
            } => {
                validate_id(member_id)?;
                validate_id(metric_id)?;
            }
            Self::MatchContext {
                match_id,
                source_match_revision,
                ..
            } => {
                validate_id(match_id)?;
                validate_decimal(source_match_revision)?;
            }
            Self::Aggregate { .. } | Self::Review { .. } => {}
        }
        Ok(())
    }

    #[must_use]
    pub const fn common(&self) -> &CommonResource {
        match self {
            Self::Aggregate { common }
            | Self::Review { common }
            | Self::Drilldown { common, .. }
            | Self::MatchContext { common, .. } => common,
        }
    }

    /// Compares resource identities in the canonical manifest order without allocating keys.
    #[must_use]
    pub fn canonical_cmp(&self, other: &Self) -> Ordering {
        resource_kind_order(self)
            .cmp(&resource_kind_order(other))
            .then_with(|| self.common().scope.canonical_cmp(&other.common().scope))
            .then_with(|| self.common().item_key.cmp(&other.common().item_key))
    }

    fn root_entry(&self) -> RootEntry<'_> {
        let common = self.common();
        RootEntry {
            checksum: &common.checksum,
            decoded_bytes: common.decoded_bytes,
            encoded_bytes: common.encoded_bytes,
            item_key: &common.item_key,
            kind: match self {
                Self::Aggregate { .. } => "aggregate",
                Self::Review { .. } => "review",
                Self::Drilldown { .. } => "drilldown",
                Self::MatchContext { .. } => "match_context",
            },
            scope_key: common.scope.key(),
        }
    }
}

impl ScopeRef {
    fn validate(&self) -> Result<(), ContractError> {
        match self {
            Self::Overall => Ok(()),
            Self::Season { season_master_id } => validate_id(season_master_id),
            Self::Map { map_master_id } => validate_id(map_master_id),
            Self::SeasonMap {
                season_master_id,
                map_master_id,
            } => {
                validate_id(season_master_id)?;
                validate_id(map_master_id)
            }
        }
    }

    #[must_use]
    pub fn key(&self) -> String {
        match self {
            Self::Overall => String::from("overall"),
            Self::Season { season_master_id } => format!("season:{season_master_id}"),
            Self::Map { map_master_id } => format!("map:{map_master_id}"),
            Self::SeasonMap {
                season_master_id,
                map_master_id,
            } => format!("season_map:{season_master_id}:{map_master_id}"),
        }
    }

    fn canonical_cmp(&self, other: &Self) -> Ordering {
        scope_ordering_parts(self).cmp(&scope_ordering_parts(other))
    }

    /// Builds the infallible wire representation used inside calculated payloads.
    #[must_use]
    pub(crate) fn json_value(&self) -> Value {
        match self {
            Self::Overall => json!({ "kind": "overall" }),
            Self::Season { season_master_id } => {
                json!({ "kind": "season", "seasonMasterId": season_master_id })
            }
            Self::Map { map_master_id } => {
                json!({ "kind": "map", "mapMasterId": map_master_id })
            }
            Self::SeasonMap {
                season_master_id,
                map_master_id,
            } => json!({
                "kind": "season_map",
                "seasonMasterId": season_master_id,
                "mapMasterId": map_master_id,
            }),
        }
    }
}

const fn resource_kind_order(resource: &ResourceManifest) -> u8 {
    match resource {
        ResourceManifest::Aggregate { .. } => 0,
        ResourceManifest::Review { .. } => 1,
        ResourceManifest::Drilldown { .. } => 2,
        ResourceManifest::MatchContext { .. } => 3,
    }
}

fn scope_ordering_parts(scope: &ScopeRef) -> (u8, &str, &str) {
    // This preserves lexicographic ordering of the canonical keys: map, overall, season,
    // season_map.
    match scope {
        ScopeRef::Map { map_master_id } => (0, map_master_id, ""),
        ScopeRef::Overall => (1, "", ""),
        ScopeRef::Season { season_master_id } => (2, season_master_id, ""),
        ScopeRef::SeasonMap {
            season_master_id,
            map_master_id,
        } => (3, season_master_id, map_master_id),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RootEntry<'a> {
    checksum: &'a str,
    decoded_bytes: u64,
    encoded_bytes: u64,
    item_key: &'a str,
    kind: &'a str,
    scope_key: String,
}

fn validate_id(value: &str) -> Result<(), ContractError> {
    if value.is_empty()
        || value.len() > 128
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
    {
        return Err(ContractError::InvalidIdentifier(String::from(value)));
    }
    Ok(())
}

fn validate_version(value: &str) -> Result<(), ContractError> {
    if value.is_empty()
        || value.len() > 64
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && b"._-".contains(&byte))
        })
    {
        return Err(ContractError::InvalidIdentifier(String::from(value)));
    }
    Ok(())
}

fn validate_decimal(value: &str) -> Result<(), ContractError> {
    if value.is_empty()
        || value.len() > 19
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(ContractError::InvalidDecimal(String::from(value)));
    }
    Ok(())
}

fn validate_checksum(value: &str) -> Result<(), ContractError> {
    let valid = value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    });
    if !valid {
        return Err(ContractError::InvalidChecksum(String::from(value)));
    }
    Ok(())
}

fn validate_file_name(value: &str) -> Result<(), ContractError> {
    let path = Path::new(value);
    if path.file_name().and_then(|name| name.to_str()) != Some(value)
        || path.extension() != Some(OsStr::new("json"))
        || value.len() > 255
    {
        return Err(ContractError::UnsafePath(String::from(value)));
    }
    Ok(())
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "contract fixtures abort with the decoder or validator error that invalidates them"
)]
mod tests {
    use super::*;

    const VALID_ARTIFACT: &str =
        include_str!("../../../../../docs/schemas/fixtures/series-analysis/valid-artifact-v1.json");
    const INVALID_ARTIFACT: &str = include_str!(
        "../../../../../docs/schemas/fixtures/series-analysis/invalid-artifact-v1.json"
    );
    const VALID_QUEUE: &str = include_str!(
        "../../../../../docs/schemas/fixtures/series-analysis/valid-queue-payload-v1.json"
    );
    const INVALID_QUEUE: &str = include_str!(
        "../../../../../docs/schemas/fixtures/series-analysis/invalid-queue-payload-v1.json"
    );

    #[test]
    fn accepts_the_shared_artifact_fixture() {
        let manifest: ArtifactManifest = serde_json::from_str(VALID_ARTIFACT)
            .unwrap_or_else(|error| panic!("valid artifact did not decode: {error}"));
        manifest
            .validate(16, 16 * 1024 * 1024)
            .unwrap_or_else(|error| panic!("valid artifact was rejected: {error}"));
    }

    #[test]
    fn rejects_the_shared_invalid_artifact_fixture() {
        let value: Value = serde_json::from_str(INVALID_ARTIFACT)
            .unwrap_or_else(|error| panic!("invalid-artifact fixture is malformed JSON: {error}"));
        assert!(
            serde_json::from_value::<ArtifactManifest>(value).is_err(),
            "invalid-artifact fixture unexpectedly satisfied the typed manifest contract"
        );
    }

    #[test]
    fn queue_payload_is_minimal_and_versioned() {
        let payload: QueuePayload = serde_json::from_str(VALID_QUEUE)
            .unwrap_or_else(|error| panic!("valid queue payload did not decode: {error}"));
        payload
            .validate()
            .unwrap_or_else(|error| panic!("valid queue payload was rejected: {error}"));
        let invalid: Value = serde_json::from_str(INVALID_QUEUE)
            .unwrap_or_else(|error| panic!("invalid-queue fixture is malformed JSON: {error}"));
        assert!(
            serde_json::from_value::<QueuePayload>(invalid).is_err(),
            "invalid-queue fixture unexpectedly satisfied the minimal payload contract"
        );
    }
}
