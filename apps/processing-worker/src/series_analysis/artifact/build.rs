use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::Path,
    time::{Duration, Instant},
};

use serde::{Serialize, Serializer};
use sha2::{Digest, Sha256};

use momo_analysis_core::{
    canonical::{FramedSha256, lower_hex, write_canonical},
    compute::{ComputedResource, ComputedResourceKind, try_for_each_resource},
    contract::{
        ARTIFACT_SCHEMA_VERSION, ArtifactManifest, CommonResource, MANIFEST_VERSION,
        ResourceManifest,
    },
    model::NormalizedAnalysisInput,
    payload,
};

use super::{
    ArtifactBuildRequest, ArtifactError, BuiltArtifact,
    shared::{MANIFEST_FILE_NAME, nesting_depth},
};

struct ArtifactWriter<'a> {
    request: &'a ArtifactBuildRequest,
    output_directory: &'a Path,
    total_bytes: u64,
    encoding_duration: Duration,
    resources: Vec<ResourceManifest>,
    payloads: payload::PayloadSetValidator,
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
            payloads: payload::PayloadSetValidator::new(),
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
        self.payloads.add_computed(&resource)?;
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

    fn finish(mut self) -> Result<(u64, Duration, Vec<ResourceManifest>), ArtifactError> {
        self.payloads.finish()?;
        self.resources.sort_by(ResourceManifest::canonical_cmp);
        Ok((self.total_bytes, self.encoding_duration, self.resources))
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
) -> Result<BuiltArtifact, ArtifactError> {
    let build_started = Instant::now();
    validate_empty_directory(output_directory)?;
    if input
        .resource_count()
        .is_none_or(|count| count > request.maximum_chunk_count)
    {
        return Err(ArtifactError::ResourceBound);
    }
    let source_input_checksum = source_input_checksum(input)?;

    let mut writer = ArtifactWriter::new(request, output_directory)?;
    try_for_each_resource(input, |resource| writer.write(resource))?;
    let (total_bytes, mut encoding_duration, resources) = writer.finish()?;

    let manifest_encoding_started = Instant::now();
    let mut manifest = ArtifactManifest {
        manifest_version: MANIFEST_VERSION,
        artifact_id: request.artifact_id.clone(),
        game_title_id: String::from(input.game_title_id()),
        input_revision: input.input_revision().to_string(),
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
    Ok(BuiltArtifact {
        manifest,
        calculation_duration: total_duration.saturating_sub(encoding_duration),
        encoding_duration,
        chunk_bytes: total_bytes,
        directory_bytes: final_total_bytes,
    })
}

fn source_input_checksum(input: &NormalizedAnalysisInput) -> Result<String, ArtifactError> {
    let mut digest = FramedSha256::new();
    let mut buffer = Vec::with_capacity(512);
    digest.update_serialized(
        &SourceHeader {
            game_title_id: input.game_title_id(),
            input_revision: Decimal(input.input_revision()),
        },
        &mut buffer,
    )?;
    for row in input.player_matches() {
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

impl<'a> From<&'a momo_analysis_core::model::PlayerMatchInput> for SourceRow<'a> {
    fn from(row: &'a momo_analysis_core::model::PlayerMatchInput) -> Self {
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

struct CanonicalFileMetadata {
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

    fn finish(self) -> CanonicalFileMetadata {
        CanonicalFileMetadata {
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
) -> Result<CanonicalFileMetadata, ArtifactError> {
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
