#![expect(
    clippy::panic,
    reason = "filesystem fixture construction must abort with the originating setup error"
)]

use std::{fs, io, path::Path};

use serde_json::Value;
use tempfile::TempDir;

use momo_analysis_core::{
    canonical::{canonicalize_value, sha256_prefixed},
    contract::{ArtifactManifest, ResourceManifest},
    model::{AnalysisInput, IncidentCounts, PlayerMatchInput},
    payload,
};

use super::{
    ArtifactBuildRequest, ArtifactError, build_artifact,
    shared::{MANIFEST_FILE_NAME, nesting_depth, resource_common},
    validate_artifact_directory,
};

fn input() -> AnalysisInput {
    AnalysisInput {
        game_title_id: String::from("title-artifact"),
        input_revision: 2,
        player_matches: (1..=4)
            .map(|player| PlayerMatchInput {
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
    build_artifact(&input.into_normalized(), request, directory).map(|artifact| artifact.manifest)
}

fn rewrite_manifest(directory: &Path, manifest: &mut ArtifactManifest) {
    manifest.root_checksum = manifest
        .computed_root_checksum()
        .unwrap_or_else(|error| panic!("root checksum: {error}"));
    let manifest_value =
        serde_json::to_value(&*manifest).unwrap_or_else(|error| panic!("manifest value: {error}"));
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
    let validated =
        validate(directory.path()).unwrap_or_else(|error| panic!("artifact validation: {error}"));
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
            ResourceManifest::Aggregate { .. } => (aggregates + 1, reviews, drilldowns, contexts),
            ResourceManifest::Review { .. } => (aggregates, reviews + 1, drilldowns, contexts),
            ResourceManifest::Drilldown { .. } => (aggregates, reviews, drilldowns + 1, contexts),
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
fn rejects_an_impossible_resource_count_before_writing_payloads() {
    let directory = TempDir::new().unwrap_or_else(|error| panic!("temp directory: {error}"));
    let mut bounded = request();
    bounded.maximum_chunk_count = 1;
    bounded.maximum_file_count = 2;

    let result = build(input(), &bounded, directory.path());
    let written = fs::read_dir(directory.path())
        .unwrap_or_else(|error| panic!("read attempt directory: {error}"))
        .count();

    assert!(matches!(result, Err(ArtifactError::ResourceBound)));
    assert_eq!(written, 0);
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
    reversed.player_matches.reverse();

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
    fs::write(&resource_path, &bytes).unwrap_or_else(|error| panic!("rewrite payload: {error}"));
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
    let canonical =
        fs::read(&resource_path).unwrap_or_else(|error| panic!("read aggregate payload: {error}"));
    let mut noncanonical = Vec::with_capacity(canonical.len() + 1);
    noncanonical.push(b' ');
    noncanonical.extend_from_slice(&canonical);
    fs::write(&resource_path, &noncanonical)
        .unwrap_or_else(|error| panic!("rewrite aggregate payload: {error}"));
    aggregate.encoded_bytes =
        u64::try_from(noncanonical.len()).unwrap_or_else(|error| panic!("payload length: {error}"));
    aggregate.decoded_bytes = aggregate.encoded_bytes;
    aggregate.checksum = sha256_prefixed(&noncanonical);
    rewrite_manifest(directory.path(), &mut manifest);

    assert!(matches!(
        validate(directory.path()),
        Err(ArtifactError::Canonical(
            momo_analysis_core::canonical::CanonicalError::NonCanonical
        ))
    ));
}
