use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::Path,
    time::{Duration, Instant},
};

use serde::{Serialize, Serializer};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

#[cfg(test)]
use momo_analysis_core::canonical::canonicalize_value;
#[cfg(test)]
use momo_analysis_core::model::AnalysisInput;
use momo_analysis_core::{
    canonical::{
        CanonicalError, FramedSha256, lower_hex, parse_canonical_json, sha256_prefixed,
        write_canonical,
    },
    compute::{ComputedResource, ComputedResourceKind, try_for_each_resource},
    contract::{
        ARTIFACT_SCHEMA_VERSION, ArtifactManifest, CommonResource, ContractError, MANIFEST_VERSION,
        ResourceManifest,
    },
    model::NormalizedAnalysisInput,
    payload,
};

const MANIFEST_FILE_NAME: &str = "manifest.json";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ArtifactBuildRequest {
    pub artifact_id: String,
    pub algorithm_version: String,
    pub maximum_chunk_bytes: u64,
    pub maximum_chunk_count: u64,
    pub maximum_total_bytes: u64,
    pub maximum_file_count: u64,
}

pub(crate) struct ArtifactBuild {
    pub manifest: ArtifactManifest,
    pub calculation_duration: Duration,
    pub encoding_duration: Duration,
    pub payload_bytes: u64,
    pub temporary_bytes: u64,
}

#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("artifact directory is not an owned empty directory")]
    UnsafeDirectory,
    #[error("artifact file-system operation failed")]
    Io(#[from] io::Error),
    #[error("artifact canonicalization failed")]
    Canonical(#[from] CanonicalError),
    #[error("artifact manifest validation failed")]
    Contract(#[from] ContractError),
    #[error("artifact exceeds its configured resource bounds")]
    ResourceBound,
    #[error("artifact metadata conversion exceeded a supported integer bound")]
    NumericConversion(#[from] std::num::TryFromIntError),
    #[error("artifact payload validation failed")]
    Payload(#[from] payload::PayloadError),
}

struct ArtifactWriter<'a> {
    request: &'a ArtifactBuildRequest,
    output_directory: &'a Path,
    total_bytes: u64,
    encoding_duration: Duration,
    resources: Vec<ResourceManifest>,
}

impl<'a> ArtifactWriter<'a> {
    fn new(
        request: &'a ArtifactBuildRequest,
        output_directory: &'a Path,
    ) -> Result<Self, ArtifactError> {
        let initial_capacity = usize::try_from(request.maximum_chunk_count.min(1_024))?;
        Ok(Self {
            request,
            output_directory,
            total_bytes: 0,
            encoding_duration: Duration::ZERO,
            resources: Vec::with_capacity(initial_capacity),
        })
    }

    fn write(&mut self, resource: ComputedResource) -> Result<(), ArtifactError> {
        let encoding_started = Instant::now();
        let next_count = u64::try_from(self.resources.len())?
            .checked_add(1)
            .ok_or(ArtifactError::ResourceBound)?;
        if next_count > self.request.maximum_chunk_count
            || next_count
                .checked_add(1)
                .is_none_or(|count| count > self.request.maximum_file_count)
        {
            return Err(ArtifactError::ResourceBound);
        }
        payload::validate_computed(&resource)?;
        let scope_key = resource.scope.key();
        let item_key = resource_item_key(&resource.kind, &scope_key);
        let path = resource_file_name(&resource.kind, &scope_key, &item_key);
        let remaining_total_bytes = self
            .request
            .maximum_total_bytes
            .checked_sub(self.total_bytes)
            .ok_or(ArtifactError::ResourceBound)?;
        let file = write_canonical_file(
            &self.output_directory.join(&path),
            &resource.payload,
            self.request.maximum_chunk_bytes.min(remaining_total_bytes),
        )?;
        if file.encoded_bytes < 2 {
            return Err(ArtifactError::ResourceBound);
        }
        self.total_bytes = self
            .total_bytes
            .checked_add(file.encoded_bytes)
            .filter(|total| *total <= self.request.maximum_total_bytes)
            .ok_or(ArtifactError::ResourceBound)?;
        let nesting_depth = nesting_depth(&resource.payload);
        let ComputedResource {
            scope,
            kind,
            payload: _,
            item_count,
            source_match_revision,
        } = resource;
        let common = CommonResource {
            scope,
            item_key,
            path,
            encoded_bytes: file.encoded_bytes,
            decoded_bytes: file.encoded_bytes,
            item_count: u64::try_from(item_count)?,
            nesting_depth,
            checksum: file.checksum,
        };
        self.resources
            .push(resource_manifest(kind, source_match_revision, common)?);
        self.encoding_duration = self
            .encoding_duration
            .saturating_add(encoding_started.elapsed());
        Ok(())
    }

    fn finish(mut self) -> (u64, Duration, Vec<ResourceManifest>) {
        self.resources.sort_by(ResourceManifest::canonical_cmp);
        (self.total_bytes, self.encoding_duration, self.resources)
    }
}

fn resource_manifest(
    kind: ComputedResourceKind,
    source_match_revision: Option<i64>,
    common: CommonResource,
) -> Result<ResourceManifest, ArtifactError> {
    Ok(match kind {
        ComputedResourceKind::Aggregate => ResourceManifest::Aggregate { common },
        ComputedResourceKind::Review => ResourceManifest::Review { common },
        ComputedResourceKind::Drilldown { member_id, metric } => ResourceManifest::Drilldown {
            common,
            member_id,
            metric_id: String::from(metric.wire()),
        },
        ComputedResourceKind::MatchContext { match_id } => ResourceManifest::MatchContext {
            common,
            match_id,
            source_match_revision: source_match_revision
                .ok_or(ArtifactError::ResourceBound)?
                .to_string(),
        },
    })
}

/// Computes all resources and writes a canonical, bounded attempt directory.
///
/// # Errors
///
/// Returns a safe error without reusing a partial directory when any resource violates a bound.
pub(crate) fn build_artifact(
    input: &NormalizedAnalysisInput,
    request: &ArtifactBuildRequest,
    output_directory: &Path,
) -> Result<ArtifactBuild, ArtifactError> {
    let build_started = Instant::now();
    validate_empty_directory(output_directory)?;
    let source_input_checksum = source_input_checksum(input)?;

    let mut writer = ArtifactWriter::new(request, output_directory)?;
    try_for_each_resource(input, |resource| writer.write(resource))?;
    let (total_bytes, mut encoding_duration, resources) = writer.finish();

    let manifest_encoding_started = Instant::now();
    let mut manifest = ArtifactManifest {
        manifest_version: MANIFEST_VERSION,
        artifact_id: request.artifact_id.clone(),
        game_title_id: input.game_title_id.clone(),
        input_revision: input.input_revision.to_string(),
        algorithm_version: request.algorithm_version.clone(),
        artifact_schema_version: ARTIFACT_SCHEMA_VERSION,
        source_input_checksum,
        root_checksum: String::from(
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        ),
        resources,
    };
    manifest.root_checksum = manifest.computed_root_checksum()?;
    manifest.validate(request.maximum_chunk_count, request.maximum_chunk_bytes)?;
    let remaining_total_bytes = request
        .maximum_total_bytes
        .checked_sub(total_bytes)
        .ok_or(ArtifactError::ResourceBound)?;
    let manifest_file = write_canonical_file(
        &output_directory.join(MANIFEST_FILE_NAME),
        &manifest,
        request.maximum_chunk_bytes.min(remaining_total_bytes),
    )?;
    if manifest_file.encoded_bytes < 2 {
        return Err(ArtifactError::ResourceBound);
    }
    if total_bytes
        .checked_add(manifest_file.encoded_bytes)
        .is_none_or(|total| total > request.maximum_total_bytes)
    {
        return Err(ArtifactError::ResourceBound);
    }
    let final_total_bytes = total_bytes
        .checked_add(manifest_file.encoded_bytes)
        .ok_or(ArtifactError::ResourceBound)?;
    encoding_duration = encoding_duration.saturating_add(manifest_encoding_started.elapsed());
    let total_duration = build_started.elapsed();
    Ok(ArtifactBuild {
        manifest,
        calculation_duration: total_duration.saturating_sub(encoding_duration),
        encoding_duration,
        payload_bytes: total_bytes,
        temporary_bytes: final_total_bytes,
    })
}

/// Re-opens and validates every declared file without loading all chunks at once.
///
/// # Errors
///
/// Returns an error for undeclared files, links, byte/checksum drift, or a manifest violation.
pub(crate) fn validate_artifact_directory(
    directory: &Path,
    maximum_chunk_count: u64,
    maximum_chunk_bytes: u64,
    maximum_total_bytes: u64,
    maximum_file_count: u64,
) -> Result<ArtifactManifest, ArtifactError> {
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ArtifactError::UnsafeDirectory);
    }
    let manifest_path = directory.join(MANIFEST_FILE_NAME);
    let manifest_metadata = fs::symlink_metadata(&manifest_path)?;
    if !manifest_metadata.is_file() || manifest_metadata.file_type().is_symlink() {
        return Err(ArtifactError::UnsafeDirectory);
    }
    if manifest_metadata.len() > maximum_chunk_bytes
        || manifest_metadata.len() > maximum_total_bytes
    {
        return Err(ArtifactError::ResourceBound);
    }
    let manifest_bytes = fs::read(&manifest_path)?;
    let manifest: ArtifactManifest = serde_json::from_value(parse_canonical_json(&manifest_bytes)?)
        .map_err(|error| ArtifactError::Canonical(CanonicalError::InvalidJson(error)))?;
    manifest.validate(maximum_chunk_count, maximum_chunk_bytes)?;
    let declared = manifest
        .resources
        .iter()
        .map(|resource| resource_common(resource).path.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut file_count = 0_u64;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        file_count = file_count
            .checked_add(1)
            .ok_or(ArtifactError::ResourceBound)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(ArtifactError::UnsafeDirectory);
        };
        if file_count > maximum_file_count
            || (name != MANIFEST_FILE_NAME && !declared.contains(name))
        {
            return Err(ArtifactError::UnsafeDirectory);
        }
    }
    let mut total_bytes = u64::try_from(manifest_bytes.len())?;
    for resource in &manifest.resources {
        let common = resource_common(resource);
        let path = directory.join(&common.path);
        let resource_metadata = fs::symlink_metadata(&path)?;
        if !resource_metadata.is_file() || resource_metadata.file_type().is_symlink() {
            return Err(ArtifactError::UnsafeDirectory);
        }
        if resource_metadata.len() != common.encoded_bytes
            || resource_metadata.len() > maximum_chunk_bytes
        {
            return Err(ArtifactError::ResourceBound);
        }
        let bytes = fs::read(path)?;
        let length = u64::try_from(bytes.len())?;
        total_bytes = total_bytes
            .checked_add(length)
            .ok_or(ArtifactError::ResourceBound)?;
        if length != common.encoded_bytes
            || length > maximum_chunk_bytes
            || sha256_prefixed(&bytes) != common.checksum
        {
            return Err(ArtifactError::ResourceBound);
        }
        let value: Value = serde_json::from_value(parse_canonical_json(&bytes)?)
            .map_err(|error| ArtifactError::Canonical(CanonicalError::InvalidJson(error)))?;
        if nesting_depth(&value) != common.nesting_depth || common.decoded_bytes != length {
            return Err(ArtifactError::ResourceBound);
        }
        payload::validate_manifest(resource, &value)?;
    }
    if total_bytes > maximum_total_bytes {
        return Err(ArtifactError::ResourceBound);
    }
    Ok(manifest)
}

fn source_input_checksum(input: &NormalizedAnalysisInput) -> Result<String, ArtifactError> {
    let mut digest = FramedSha256::new();
    let mut buffer = Vec::with_capacity(512);
    digest.update_serialized(
        &SourceHeader {
            game_title_id: &input.game_title_id,
            input_revision: Decimal(input.input_revision),
        },
        &mut buffer,
    )?;
    for row in &input.rows {
        digest.update_serialized(&SourceRow::from(row), &mut buffer)?;
    }
    Ok(digest.finalize())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceHeader<'a> {
    game_title_id: &'a str,
    input_revision: Decimal,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRow<'a> {
    match_id: &'a str,
    match_revision: Decimal,
    played_at: &'a str,
    held_event_id: &'a str,
    match_no_in_event: i32,
    season_master_id: &'a str,
    map_master_id: &'a str,
    member_id: &'a str,
    play_order: i32,
    rank: i32,
    total_assets_man_yen: i32,
    revenue_man_yen: i32,
    incidents: &'a momo_analysis_core::model::IncidentCounts,
}

impl<'a> From<&'a momo_analysis_core::model::MatchPlayerRow> for SourceRow<'a> {
    fn from(row: &'a momo_analysis_core::model::MatchPlayerRow) -> Self {
        Self {
            match_id: &row.match_id,
            match_revision: Decimal(row.match_revision),
            played_at: &row.played_at,
            held_event_id: &row.held_event_id,
            match_no_in_event: row.match_no_in_event,
            season_master_id: &row.season_master_id,
            map_master_id: &row.map_master_id,
            member_id: &row.member_id,
            play_order: row.play_order,
            rank: row.rank,
            total_assets_man_yen: row.total_assets_man_yen,
            revenue_man_yen: row.revenue_man_yen,
            incidents: &row.incidents,
        }
    }
}

#[derive(Clone, Copy)]
struct Decimal(i64);

impl Serialize for Decimal {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.collect_str(&self.0)
    }
}

fn resource_item_key(kind: &ComputedResourceKind, scope_key: &str) -> String {
    match kind {
        ComputedResourceKind::Aggregate | ComputedResourceKind::Review => String::from(scope_key),
        ComputedResourceKind::Drilldown { member_id, metric } => {
            format!("{member_id}:{}", metric.wire())
        }
        ComputedResourceKind::MatchContext { match_id } => match_id.clone(),
    }
}

fn resource_file_name(kind: &ComputedResourceKind, scope_key: &str, item_key: &str) -> String {
    let prefix = match kind {
        ComputedResourceKind::Aggregate => "aggregate",
        ComputedResourceKind::Review => "review",
        ComputedResourceKind::Drilldown { .. } => "drilldown",
        ComputedResourceKind::MatchContext { .. } => "match-context",
    };
    let mut digest = Sha256::new();
    digest.update(prefix.as_bytes());
    digest.update([0]);
    digest.update(scope_key.as_bytes());
    digest.update([0]);
    digest.update(item_key.as_bytes());
    let digest = digest.finalize();
    let digest_prefix = momo_analysis_core::canonical::lower_hex_prefix(&digest, 12);
    format!("{prefix}-{digest_prefix}.json")
}

const fn resource_common(resource: &ResourceManifest) -> &CommonResource {
    match resource {
        ResourceManifest::Aggregate { common }
        | ResourceManifest::Review { common }
        | ResourceManifest::Drilldown { common, .. }
        | ResourceManifest::MatchContext { common, .. } => common,
    }
}

struct CanonicalFile {
    encoded_bytes: u64,
    checksum: String,
}

struct BoundedHashWriter {
    file: File,
    digest: Sha256,
    encoded_bytes: u64,
    maximum_bytes: u64,
    bound_exceeded: bool,
    io_failed: bool,
}

impl BoundedHashWriter {
    fn new(file: File, maximum_bytes: u64) -> Self {
        Self {
            file,
            digest: Sha256::new(),
            encoded_bytes: 0,
            maximum_bytes,
            bound_exceeded: false,
            io_failed: false,
        }
    }

    fn finish(self) -> CanonicalFile {
        CanonicalFile {
            encoded_bytes: self.encoded_bytes,
            checksum: format!("sha256:{}", lower_hex(&self.digest.finalize())),
        }
    }
}

impl Write for BoundedHashWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(next_bytes) = u64::try_from(buffer.len())
            .ok()
            .and_then(|length| self.encoded_bytes.checked_add(length))
        else {
            self.bound_exceeded = true;
            return Err(io::Error::other("canonical artifact byte count exceeded"));
        };
        if next_bytes > self.maximum_bytes {
            self.bound_exceeded = true;
            return Err(io::Error::other("canonical artifact byte bound exceeded"));
        }
        if let Err(error) = self.file.write_all(buffer) {
            self.io_failed = true;
            return Err(error);
        }
        self.digest.update(buffer);
        self.encoded_bytes = next_bytes;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

struct IncompleteFile<'a> {
    path: &'a Path,
    complete: bool,
}

impl<'a> IncompleteFile<'a> {
    const fn new(path: &'a Path) -> Self {
        Self {
            path,
            complete: false,
        }
    }

    const fn complete(&mut self) {
        self.complete = true;
    }
}

impl Drop for IncompleteFile<'_> {
    fn drop(&mut self) {
        if !self.complete {
            let _ignored = fs::remove_file(self.path);
        }
    }
}

fn write_canonical_file<T: Serialize>(
    path: &Path,
    value: &T,
    maximum_bytes: u64,
) -> Result<CanonicalFile, ArtifactError> {
    let mut incomplete = IncompleteFile::new(path);
    let file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let mut writer = BoundedHashWriter::new(file, maximum_bytes);
    if let Err(error) = write_canonical(value, &mut writer) {
        return if writer.bound_exceeded {
            Err(ArtifactError::ResourceBound)
        } else if writer.io_failed {
            Err(ArtifactError::Io(io::Error::other(
                "canonical artifact file write failed",
            )))
        } else {
            Err(ArtifactError::Canonical(error))
        };
    }
    writer.flush()?;
    let result = writer.finish();
    incomplete.complete();
    Ok(result)
}

fn validate_empty_directory(path: &Path) -> Result<(), ArtifactError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || fs::read_dir(path)?.next().is_some()
    {
        return Err(ArtifactError::UnsafeDirectory);
    }
    Ok(())
}

fn nesting_depth(value: &Value) -> u32 {
    match value {
        Value::Array(values) => 1 + values.iter().map(nesting_depth).max().unwrap_or(0),
        Value::Object(values) => 1 + values.values().map(nesting_depth).max().unwrap_or(0),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => 1,
    }
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "filesystem fixture construction must abort with the originating setup error"
)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use momo_analysis_core::model::{IncidentCounts, MatchPlayerRow};

    fn input() -> AnalysisInput {
        AnalysisInput {
            game_title_id: String::from("title-artifact"),
            input_revision: 2,
            rows: (1..=4)
                .map(|player| MatchPlayerRow {
                    match_id: String::from("match-1"),
                    match_revision: 1,
                    played_at: String::from("2026-08-09T00:00:00.000000Z"),
                    held_event_id: String::from("event-1"),
                    match_no_in_event: 1,
                    season_master_id: String::from("season-1"),
                    map_master_id: String::from("map-1"),
                    member_id: format!("member-{player}"),
                    play_order: player,
                    rank: player,
                    total_assets_man_yen: player * 1_000,
                    revenue_man_yen: player * 100,
                    incidents: IncidentCounts::default(),
                })
                .collect(),
        }
    }

    fn request() -> ArtifactBuildRequest {
        ArtifactBuildRequest {
            artifact_id: String::from("artifact-test-1"),
            algorithm_version: String::from("series-analysis-v1"),
            maximum_chunk_bytes: 16 * 1024 * 1024,
            maximum_chunk_count: 1_000,
            maximum_total_bytes: 64 * 1024 * 1024,
            maximum_file_count: 1_001,
        }
    }

    fn validate(directory: &Path) -> Result<ArtifactManifest, ArtifactError> {
        validate_artifact_directory(directory, 1_000, 16 * 1024 * 1024, 64 * 1024 * 1024, 1_001)
    }

    fn build(
        input: AnalysisInput,
        request: &ArtifactBuildRequest,
        directory: &Path,
    ) -> Result<ArtifactManifest, ArtifactError> {
        build_artifact(&input.into_normalized(), request, directory)
            .map(|artifact| artifact.manifest)
    }

    fn rewrite_manifest(directory: &Path, manifest: &mut ArtifactManifest) {
        manifest.root_checksum = manifest
            .computed_root_checksum()
            .unwrap_or_else(|error| panic!("root checksum: {error}"));
        let manifest_value = serde_json::to_value(&*manifest)
            .unwrap_or_else(|error| panic!("manifest value: {error}"));
        let manifest_bytes = canonicalize_value(&manifest_value)
            .unwrap_or_else(|error| panic!("canonical manifest: {error}"));
        fs::write(directory.join(MANIFEST_FILE_NAME), manifest_bytes)
            .unwrap_or_else(|error| panic!("rewrite manifest: {error}"));
    }

    #[test]
    fn builds_and_stream_validates_a_complete_artifact() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let manifest = build(input(), &request(), directory.path())
            .unwrap_or_else(|error| panic!("artifact build: {error}"));
        let validated = validate(directory.path())
            .unwrap_or_else(|error| panic!("artifact validation: {error}"));
        assert_eq!(validated, manifest);
        assert_eq!(manifest.artifact_id, "artifact-test-1");
        assert_eq!(manifest.game_title_id, "title-artifact");
        assert_eq!(manifest.input_revision, "2");
        assert_eq!(manifest.algorithm_version, "series-analysis-v1");
        assert_eq!(
            manifest.root_checksum,
            "sha256:524001b2b7a735365f1f61c0f07ae5e767c3430ef34eac08ef24b6293b08ef9d"
        );
        let resource_counts = manifest.resources.iter().fold(
            (0_usize, 0_usize, 0_usize, 0_usize),
            |(aggregates, reviews, drilldowns, contexts), resource| match resource {
                ResourceManifest::Aggregate { .. } => {
                    (aggregates + 1, reviews, drilldowns, contexts)
                }
                ResourceManifest::Review { .. } => (aggregates, reviews + 1, drilldowns, contexts),
                ResourceManifest::Drilldown { .. } => {
                    (aggregates, reviews, drilldowns + 1, contexts)
                }
                ResourceManifest::MatchContext { .. } => {
                    (aggregates, reviews, drilldowns, contexts + 1)
                }
            },
        );
        assert_eq!(resource_counts, (4, 4, 64, 4));
        assert_eq!(
            fs::read_dir(directory.path())
                .unwrap_or_else(|error| panic!("read artifact directory: {error}"))
                .count(),
            manifest.resources.len() + 1
        );
    }

    #[test]
    fn stops_writing_as_soon_as_the_resource_count_bound_is_reached() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let mut bounded = request();
        bounded.maximum_chunk_count = 1;
        bounded.maximum_file_count = 2;

        let result = build(input(), &bounded, directory.path());
        let written = fs::read_dir(directory.path())
            .unwrap_or_else(|error| panic!("read attempt directory: {error}"))
            .count();

        assert!(matches!(result, Err(ArtifactError::ResourceBound)));
        assert_eq!(written, 1);
    }

    #[test]
    fn removes_a_partial_chunk_when_streaming_hits_the_byte_bound() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let mut bounded = request();
        bounded.maximum_chunk_bytes = 32;

        let result = build(input(), &bounded, directory.path());
        let written = fs::read_dir(directory.path())
            .unwrap_or_else(|error| panic!("read attempt directory: {error}"))
            .count();

        assert!(matches!(result, Err(ArtifactError::ResourceBound)));
        assert_eq!(written, 0);
    }

    #[test]
    fn rejects_an_undeclared_file() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        build(input(), &request(), directory.path())
            .unwrap_or_else(|error| panic!("artifact build: {error}"));
        fs::write(directory.path().join("undeclared.json"), b"{}")
            .unwrap_or_else(|error| panic!("test file: {error}"));
        assert!(matches!(
            validate(directory.path()),
            Err(ArtifactError::UnsafeDirectory)
        ));
    }

    #[test]
    fn artifact_identity_is_independent_of_database_row_order() {
        let first_directory =
            TempDir::new().unwrap_or_else(|error| panic!("first temp directory: {error}"));
        let second_directory =
            TempDir::new().unwrap_or_else(|error| panic!("second temp directory: {error}"));
        let original = input();
        let mut reversed = original.clone();
        reversed.rows.reverse();

        let first = build(original, &request(), first_directory.path())
            .unwrap_or_else(|error| panic!("first artifact: {error}"));
        let second = build(reversed, &request(), second_directory.path())
            .unwrap_or_else(|error| panic!("second artifact: {error}"));

        assert_eq!(first.source_input_checksum, second.source_input_checksum);
        assert_eq!(first.root_checksum, second.root_checksum);
        assert_eq!(first.resources, second.resources);
    }

    #[test]
    fn rejects_a_missing_declared_file() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let manifest = build(input(), &request(), directory.path())
            .unwrap_or_else(|error| panic!("artifact build: {error}"));
        let path = directory.path().join(
            &resource_common(
                manifest
                    .resources
                    .first()
                    .unwrap_or_else(|| panic!("artifact must declare at least one resource")),
            )
            .path,
        );
        fs::remove_file(path).unwrap_or_else(|error| panic!("remove declared file: {error}"));

        assert!(matches!(
            validate(directory.path()),
            Err(ArtifactError::Io(error)) if error.kind() == io::ErrorKind::NotFound
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_declared_symlink() {
        use std::os::unix::fs::symlink;

        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let manifest = build(input(), &request(), directory.path())
            .unwrap_or_else(|error| panic!("artifact build: {error}"));
        let path = directory.path().join(
            &resource_common(
                manifest
                    .resources
                    .first()
                    .unwrap_or_else(|| panic!("artifact must declare at least one resource")),
            )
            .path,
        );
        fs::remove_file(&path).unwrap_or_else(|error| panic!("remove declared file: {error}"));
        symlink(directory.path().join(MANIFEST_FILE_NAME), &path)
            .unwrap_or_else(|error| panic!("create test symlink: {error}"));

        assert!(matches!(
            validate(directory.path()),
            Err(ArtifactError::UnsafeDirectory)
        ));
    }

    #[test]
    fn rejects_schema_drift_even_when_checksums_are_recomputed() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let mut manifest = build(input(), &request(), directory.path())
            .unwrap_or_else(|error| panic!("artifact build: {error}"));
        let review = manifest
            .resources
            .iter_mut()
            .find_map(|resource| match resource {
                ResourceManifest::Review { common } => Some(common),
                ResourceManifest::Aggregate { .. }
                | ResourceManifest::Drilldown { .. }
                | ResourceManifest::MatchContext { .. } => None,
            })
            .unwrap_or_else(|| panic!("review resource"));
        let resource_path = directory.path().join(&review.path);
        let mut payload: Value = serde_json::from_slice(
            &fs::read(&resource_path).unwrap_or_else(|error| panic!("read payload: {error}")),
        )
        .unwrap_or_else(|error| panic!("decode payload: {error}"));
        payload
            .as_object_mut()
            .unwrap_or_else(|| panic!("payload object"))
            .insert(String::from("unexpectedField"), Value::Bool(true));
        let bytes = canonicalize_value(&payload)
            .unwrap_or_else(|error| panic!("canonicalize payload: {error}"));
        fs::write(&resource_path, &bytes)
            .unwrap_or_else(|error| panic!("rewrite payload: {error}"));
        review.encoded_bytes =
            u64::try_from(bytes.len()).unwrap_or_else(|error| panic!("payload length: {error}"));
        review.decoded_bytes = review.encoded_bytes;
        review.nesting_depth = nesting_depth(&payload);
        review.checksum = sha256_prefixed(&bytes);
        rewrite_manifest(directory.path(), &mut manifest);

        assert!(matches!(
            validate(directory.path()),
            Err(ArtifactError::Payload(payload::PayloadError::InvalidSchema))
        ));
    }

    #[test]
    fn rejects_noncanonical_payload_even_when_checksums_are_recomputed() {
        let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
        let mut manifest = build(input(), &request(), directory.path())
            .unwrap_or_else(|error| panic!("artifact build: {error}"));
        let aggregate = manifest
            .resources
            .iter_mut()
            .find_map(|resource| match resource {
                ResourceManifest::Aggregate { common } => Some(common),
                ResourceManifest::Review { .. }
                | ResourceManifest::Drilldown { .. }
                | ResourceManifest::MatchContext { .. } => None,
            })
            .unwrap_or_else(|| panic!("aggregate resource"));
        let resource_path = directory.path().join(&aggregate.path);
        let canonical = fs::read(&resource_path)
            .unwrap_or_else(|error| panic!("read aggregate payload: {error}"));
        let mut noncanonical = Vec::with_capacity(canonical.len() + 1);
        noncanonical.push(b' ');
        noncanonical.extend_from_slice(&canonical);
        fs::write(&resource_path, &noncanonical)
            .unwrap_or_else(|error| panic!("rewrite aggregate payload: {error}"));
        aggregate.encoded_bytes = u64::try_from(noncanonical.len())
            .unwrap_or_else(|error| panic!("payload length: {error}"));
        aggregate.decoded_bytes = aggregate.encoded_bytes;
        aggregate.checksum = sha256_prefixed(&noncanonical);
        rewrite_manifest(directory.path(), &mut manifest);

        assert!(matches!(
            validate(directory.path()),
            Err(ArtifactError::Canonical(CanonicalError::NonCanonical))
        ));
    }
}
