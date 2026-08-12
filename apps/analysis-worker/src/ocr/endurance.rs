use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
    time::Duration,
};

use redis::{Value, streams::StreamId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::{
    contract::{OcrQueuePayload, parse_delivery},
    object_store::R2ObjectStoreConfig,
};

mod local;
mod vm_memory;

pub use local::{LocalOcrEnduranceRequest, LocalOcrEnduranceThresholds, run_local_endurance};

const MAXIMUM_MANIFEST_BYTES: u64 = 64 * 1024;
const MAXIMUM_OBJECTS: usize = 24;
const MAXIMUM_RUNS: u32 = 1_000;
#[cfg(any(target_os = "linux", test))]
const BASIS_POINTS: u128 = 10_000;

pub struct OcrEnduranceRequest {
    pub manifest_path: PathBuf,
    pub runs: u32,
    pub child_memory_limit_bytes: u64,
    pub expected_runtime_memory_limit_bytes: u64,
    pub ocr_timeout: Duration,
    pub stop_grace: Duration,
    pub object_store: R2ObjectStoreConfig,
    pub thresholds: OcrEnduranceThresholds,
    pub require_full_hd: bool,
    pub require_sub_full_hd: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrEnduranceThresholds {
    pub maximum_child_peak_basis_points: u16,
    pub maximum_runtime_peak_basis_points: u16,
    pub maximum_download_p99_milliseconds: u64,
    pub maximum_download_milliseconds: u64,
    pub maximum_ocr_p99_milliseconds: u64,
    pub maximum_ocr_milliseconds: u64,
    pub maximum_total_milliseconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrEnduranceReport {
    schema_version: u8,
    mode: &'static str,
    runs_requested: u32,
    runs_completed: u32,
    successful_runs: u32,
    objects_configured: usize,
    object_runs: BTreeMap<String, u32>,
    screen_type_runs: BTreeMap<String, u32>,
    dimension_class_runs: BTreeMap<String, u32>,
    download_duration_milliseconds: DurationDistribution,
    ocr_duration_milliseconds: DurationDistribution,
    total_duration_milliseconds: DurationDistribution,
    first_run: Option<RunTiming>,
    failures: FailureCounts,
    child_memory: MemoryEvidence,
    runtime_memory: vm_memory::VmMemoryEvidence,
    runtime_cgroup_memory: RuntimeCgroupEvidence,
    thresholds: OcrEnduranceThresholds,
    require_full_hd: bool,
    require_sub_full_hd: bool,
    passed: bool,
}

impl OcrEnduranceReport {
    #[must_use]
    pub const fn passed(&self) -> bool {
        self.passed
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailureCounts {
    download: u32,
    child_start: u32,
    child_wait: u32,
    child_timeout: u32,
    domain: u32,
    screen_type_mismatch: u32,
    categories: BTreeMap<String, u32>,
}

impl FailureCounts {
    #[cfg(target_os = "linux")]
    fn total(&self) -> u32 {
        self.download
            .saturating_add(self.child_start)
            .saturating_add(self.child_wait)
            .saturating_add(self.child_timeout)
            .saturating_add(self.domain)
            .saturating_add(self.screen_type_mismatch)
    }

    #[cfg(target_os = "linux")]
    fn category(&mut self, value: &str) {
        let count = self.categories.entry(String::from(value)).or_default();
        *count = count.saturating_add(1);
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct DurationDistribution {
    count: usize,
    minimum: u64,
    p50: u64,
    p95: u64,
    p99: u64,
    maximum: u64,
    mean: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunTiming {
    object_label: String,
    download_milliseconds: u64,
    ocr_milliseconds: u64,
    total_milliseconds: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryEvidence {
    limit_bytes: u64,
    baseline_current_bytes: u64,
    final_current_bytes: u64,
    peak_bytes: u64,
    limit_hit_count_delta: u64,
    oom_kill_count_delta: u64,
    peak_basis_points: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCgroupEvidence {
    configured_limit_bytes: Option<u64>,
    baseline_current_bytes: u64,
    final_current_bytes: u64,
    baseline_peak_bytes: u64,
    final_peak_bytes: u64,
    limit_hit_count_delta: u64,
    oom_kill_count_delta: u64,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum OcrEnduranceError {
    #[error("OCR endurance configuration is invalid")]
    Configuration,
    #[error("OCR endurance manifest is invalid")]
    Manifest,
    #[error("OCR endurance manifest could not be read")]
    ManifestRead,
    #[error("OCR endurance requires the production Linux process boundary")]
    UnsupportedPlatform,
    #[error("OCR endurance cgroup evidence is unavailable")]
    Cgroup,
    #[error(
        "OCR endurance VM memory evidence is unavailable or does not match the configured class"
    )]
    RuntimeMemory,
    #[error("OCR endurance child cleanup failed")]
    Cleanup,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct EnduranceManifest {
    schema_version: u8,
    objects: Vec<ManifestObject>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ManifestObject {
    label: String,
    object_key: String,
    sha256: String,
    byte_length: u64,
    media_type: String,
    requested_screen_type: String,
    layout_family: String,
}

struct PreparedObject {
    label: String,
    payload: OcrQueuePayload,
}

/// Exercises private R2 verification and the production OCR child boundary without publishing OCR
/// output or touching database/queue state.
///
/// # Errors
///
/// Returns a closed preflight category for malformed input, unsupported runtimes, unavailable
/// cgroup evidence, or failed child cleanup. Per-run dependency and OCR failures are retained in a
/// serializable report so a complete bounded run can still be audited.
pub async fn run_r2_endurance(
    request: &OcrEnduranceRequest,
) -> Result<OcrEnduranceReport, OcrEnduranceError> {
    validate_request(request)?;
    let manifest = read_manifest(&request.manifest_path).await?;
    let objects = prepare_objects(manifest)?;
    run_linux(request, objects).await
}

fn validate_request(request: &OcrEnduranceRequest) -> Result<(), OcrEnduranceError> {
    let thresholds = request.thresholds;
    if request.runs == 0
        || request.runs > MAXIMUM_RUNS
        || request.child_memory_limit_bytes == 0
        || request.expected_runtime_memory_limit_bytes == 0
        || request.ocr_timeout.is_zero()
        || request.stop_grace.is_zero()
        || !(1..10_000).contains(&thresholds.maximum_child_peak_basis_points)
        || !(1..10_000).contains(&thresholds.maximum_runtime_peak_basis_points)
        || thresholds.maximum_download_p99_milliseconds == 0
        || thresholds.maximum_download_p99_milliseconds > thresholds.maximum_download_milliseconds
        || thresholds.maximum_ocr_p99_milliseconds == 0
        || thresholds.maximum_ocr_p99_milliseconds > thresholds.maximum_ocr_milliseconds
        || thresholds.maximum_total_milliseconds == 0
    {
        return Err(OcrEnduranceError::Configuration);
    }
    Ok(())
}

async fn read_manifest(path: &PathBuf) -> Result<EnduranceManifest, OcrEnduranceError> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_error| OcrEnduranceError::ManifestRead)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAXIMUM_MANIFEST_BYTES {
        return Err(OcrEnduranceError::Manifest);
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_error| OcrEnduranceError::ManifestRead)?;
    decode_manifest(&bytes)
}

fn decode_manifest(bytes: &[u8]) -> Result<EnduranceManifest, OcrEnduranceError> {
    let manifest: EnduranceManifest =
        serde_json::from_slice(bytes).map_err(|_error| OcrEnduranceError::Manifest)?;
    if manifest.schema_version != 1
        || manifest.objects.is_empty()
        || manifest.objects.len() > MAXIMUM_OBJECTS
    {
        return Err(OcrEnduranceError::Manifest);
    }
    Ok(manifest)
}

fn prepare_objects(manifest: EnduranceManifest) -> Result<Vec<PreparedObject>, OcrEnduranceError> {
    let mut labels = HashSet::new();
    manifest
        .objects
        .into_iter()
        .enumerate()
        .map(|(index, object)| {
            if !valid_label(&object.label) || !labels.insert(object.label.clone()) {
                return Err(OcrEnduranceError::Manifest);
            }
            let hints = serde_json::json!({ "layoutFamily": object.layout_family }).to_string();
            let fields = [
                ("schemaVersion", String::from("2")),
                ("jobId", format!("preflight-job-{index}")),
                ("draftId", format!("preflight-draft-{index}")),
                ("sourceImageId", format!("preflight-image-{index}")),
                ("imageObjectKey", object.object_key),
                ("sha256", object.sha256),
                ("byteLength", object.byte_length.to_string()),
                ("mediaType", object.media_type),
                ("requestedScreenType", object.requested_screen_type),
                ("attempt", String::from("1")),
                ("enqueuedAt", String::from("1970-01-01T00:00:00Z")),
                ("ocrHintsJson", hints),
            ];
            let delivery = StreamId {
                id: format!("0-{index}"),
                map: fields
                    .into_iter()
                    .map(|(name, value)| {
                        (String::from(name), Value::BulkString(value.into_bytes()))
                    })
                    .collect::<HashMap<_, _>>(),
            };
            let payload =
                parse_delivery(&delivery).map_err(|_error| OcrEnduranceError::Manifest)?;
            Ok(PreparedObject {
                label: object.label,
                payload,
            })
        })
        .collect()
}

fn valid_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(target_os = "linux")]
async fn run_linux(
    request: &OcrEnduranceRequest,
    objects: Vec<PreparedObject>,
) -> Result<OcrEnduranceReport, OcrEnduranceError> {
    use std::time::Instant;

    use tokio::time;

    use super::{IsolatedNativeOcrEngine, object_store::R2ObjectStore, worker::OcrEngine};
    use crate::cgroup::ChildCgroup;

    if !crate::process::worker_identity_supported() {
        return Err(OcrEnduranceError::UnsupportedPlatform);
    }
    let cgroup = ChildCgroup::from_environment(request.child_memory_limit_bytes)
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let child_before = cgroup
        .snapshot()
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let runtime_before = cgroup
        .runtime_snapshot()
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let vm_memory =
        vm_memory::VmMemorySampler::start(request.expected_runtime_memory_limit_bytes).await?;

    let store = R2ObjectStore::new(&request.object_store);
    let engine = IsolatedNativeOcrEngine::new(cgroup.clone(), None, request.stop_grace);
    let mut failures = FailureCounts::default();
    let run_capacity =
        usize::try_from(request.runs).map_err(|_error| OcrEnduranceError::Configuration)?;
    let mut download_durations = Vec::with_capacity(run_capacity);
    let mut ocr_durations = Vec::with_capacity(run_capacity);
    let mut total_durations = Vec::with_capacity(run_capacity);
    let mut first_run = None;
    let mut successful_runs = 0_u32;
    let mut object_runs = BTreeMap::<String, u32>::new();
    let mut screen_type_runs = BTreeMap::<String, u32>::new();
    let mut dimension_class_runs = BTreeMap::<String, u32>::new();

    for run_index in 0..request.runs {
        let index = usize::try_from(run_index)
            .map_err(|_error| OcrEnduranceError::Configuration)?
            % objects.len();
        let object = objects.get(index).ok_or(OcrEnduranceError::Configuration)?;
        let count = object_runs.entry(object.label.clone()).or_default();
        *count = count.saturating_add(1);
        let screen_type = object.payload.requested_screen_type().wire();
        let count = screen_type_runs
            .entry(String::from(screen_type))
            .or_default();
        *count = count.saturating_add(1);

        let total_started = Instant::now();
        let download_started = Instant::now();
        let image = match store.download(&object.payload).await {
            Ok(image) => image,
            Err(error) => {
                let download = elapsed_microseconds(download_started);
                download_durations.push(download);
                total_durations.push(elapsed_microseconds(total_started));
                failures.download = failures.download.saturating_add(1);
                failures.category(error.kind());
                continue;
            }
        };
        let download = elapsed_microseconds(download_started);
        download_durations.push(download);
        let dimension_class = if image.width() == 1_920 && image.height() == 1_080 {
            "full_hd"
        } else {
            "sub_full_hd"
        };
        let count = dimension_class_runs
            .entry(String::from(dimension_class))
            .or_default();
        *count = count.saturating_add(1);

        let ocr_started = Instant::now();
        let mut attempt = match engine.start(&image, &object.payload) {
            Ok(attempt) => attempt,
            Err(kind) => {
                let ocr = elapsed_microseconds(ocr_started);
                ocr_durations.push(ocr);
                total_durations.push(elapsed_microseconds(total_started));
                failures.child_start = failures.child_start.saturating_add(1);
                failures.category(kind);
                continue;
            }
        };
        let outcome = match time::timeout(request.ocr_timeout, attempt.wait()).await {
            Ok(outcome) => outcome,
            Err(_elapsed) => {
                attempt
                    .terminate()
                    .await
                    .map_err(|_error| OcrEnduranceError::Cleanup)?;
                let ocr = elapsed_microseconds(ocr_started);
                ocr_durations.push(ocr);
                total_durations.push(elapsed_microseconds(total_started));
                failures.child_timeout = failures.child_timeout.saturating_add(1);
                failures.category("ocr_timeout");
                continue;
            }
        };
        let ocr = elapsed_microseconds(ocr_started);
        ocr_durations.push(ocr);
        let total = elapsed_microseconds(total_started);
        total_durations.push(total);
        if first_run.is_none() {
            first_run = Some(RunTiming {
                object_label: object.label.clone(),
                download_milliseconds: milliseconds(download),
                ocr_milliseconds: milliseconds(ocr),
                total_milliseconds: milliseconds(total),
            });
        }
        match outcome {
            Err(kind) => {
                failures.child_wait = failures.child_wait.saturating_add(1);
                failures.category(kind);
            }
            Ok(Err(failure)) => {
                failures.domain = failures.domain.saturating_add(1);
                failures.category(domain_failure_kind(failure));
            }
            Ok(Ok(output))
                if output.detected_screen_type != object.payload.requested_screen_type() =>
            {
                failures.screen_type_mismatch = failures.screen_type_mismatch.saturating_add(1);
                failures.category("screen_type_mismatch");
            }
            Ok(Ok(_output)) => successful_runs = successful_runs.saturating_add(1),
        }
    }

    cgroup
        .ensure_empty()
        .map_err(|_error| OcrEnduranceError::Cleanup)?;
    let child_after = cgroup
        .snapshot()
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let runtime_after = cgroup
        .runtime_snapshot()
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let child_memory =
        memory_evidence(request.child_memory_limit_bytes, child_before, child_after)?;
    let runtime_cgroup_memory = runtime_cgroup_evidence(runtime_before, runtime_after)?;
    let runtime_memory = vm_memory.finish().await?;
    let download_distribution = distribution(download_durations);
    let ocr_distribution = distribution(ocr_durations);
    let total_distribution = distribution(total_durations);
    let passed = successful_runs == request.runs
        && failures.total() == 0
        && child_memory.limit_hit_count_delta == 0
        && child_memory.oom_kill_count_delta == 0
        && runtime_cgroup_memory.limit_hit_count_delta == 0
        && runtime_cgroup_memory.oom_kill_count_delta == 0
        && within_peak_threshold(
            child_memory,
            request.thresholds.maximum_child_peak_basis_points,
        )
        && runtime_memory
            .within_peak_threshold(request.thresholds.maximum_runtime_peak_basis_points)
        && duration_within(
            &download_distribution,
            request.thresholds.maximum_download_p99_milliseconds,
            request.thresholds.maximum_download_milliseconds,
        )
        && duration_within(
            &ocr_distribution,
            request.thresholds.maximum_ocr_p99_milliseconds,
            request.thresholds.maximum_ocr_milliseconds,
        )
        && total_distribution.maximum <= request.thresholds.maximum_total_milliseconds
        && objects
            .iter()
            .all(|object| object_runs.get(&object.label).copied().unwrap_or_default() > 0)
        && (!request.require_full_hd
            || dimension_class_runs
                .get("full_hd")
                .copied()
                .unwrap_or_default()
                > 0)
        && (!request.require_sub_full_hd
            || dimension_class_runs
                .get("sub_full_hd")
                .copied()
                .unwrap_or_default()
                > 0);

    Ok(OcrEnduranceReport {
        schema_version: 2,
        mode: "r2_isolated_ocr",
        runs_requested: request.runs,
        runs_completed: request.runs,
        successful_runs,
        objects_configured: objects.len(),
        object_runs,
        screen_type_runs,
        dimension_class_runs,
        download_duration_milliseconds: download_distribution,
        ocr_duration_milliseconds: ocr_distribution,
        total_duration_milliseconds: total_distribution,
        first_run,
        failures,
        child_memory,
        runtime_memory,
        runtime_cgroup_memory,
        thresholds: request.thresholds,
        require_full_hd: request.require_full_hd,
        require_sub_full_hd: request.require_sub_full_hd,
        passed,
    })
}

#[cfg(target_os = "linux")]
const fn domain_failure_kind(failure: super::worker::OcrEngineFailure) -> &'static str {
    use super::worker::OcrEngineFailure;

    match failure {
        OcrEngineFailure::InvalidImage => "invalid_image",
        OcrEngineFailure::UnsupportedImageFormat => "unsupported_image_format",
        OcrEngineFailure::DecodeFailed => "decode_failed",
        OcrEngineFailure::CategoryUndetected => "category_undetected",
        OcrEngineFailure::LayoutUnsupported => "layout_unsupported",
        OcrEngineFailure::EngineUnavailable => "engine_unavailable",
        OcrEngineFailure::ParserFailed => "parser_failed",
    }
}

#[cfg(not(target_os = "linux"))]
async fn run_linux(
    _request: &OcrEnduranceRequest,
    objects: Vec<PreparedObject>,
) -> Result<OcrEnduranceReport, OcrEnduranceError> {
    for object in objects {
        drop((object.label, object.payload));
    }
    std::future::ready(Err(OcrEnduranceError::UnsupportedPlatform)).await
}

#[cfg(target_os = "linux")]
fn memory_evidence(
    limit_bytes: u64,
    before: crate::cgroup::CgroupMemorySnapshot,
    after: crate::cgroup::CgroupMemorySnapshot,
) -> Result<MemoryEvidence, OcrEnduranceError> {
    evidence(
        limit_bytes,
        before.current_bytes,
        after.current_bytes,
        after.peak_bytes,
        before.limit_hit_count,
        after.limit_hit_count,
        before.oom_kill_count,
        after.oom_kill_count,
    )
}

#[cfg(target_os = "linux")]
fn runtime_cgroup_evidence(
    before: crate::cgroup::RuntimeMemorySnapshot,
    after: crate::cgroup::RuntimeMemorySnapshot,
) -> Result<RuntimeCgroupEvidence, OcrEnduranceError> {
    if after.limit_bytes != before.limit_bytes {
        return Err(OcrEnduranceError::Configuration);
    }
    Ok(RuntimeCgroupEvidence {
        configured_limit_bytes: after.limit_bytes,
        baseline_current_bytes: before.current_bytes,
        final_current_bytes: after.current_bytes,
        baseline_peak_bytes: before.peak_bytes,
        final_peak_bytes: after.peak_bytes,
        limit_hit_count_delta: after
            .limit_hit_count
            .checked_sub(before.limit_hit_count)
            .ok_or(OcrEnduranceError::Cgroup)?,
        oom_kill_count_delta: after
            .oom_kill_count
            .checked_sub(before.oom_kill_count)
            .ok_or(OcrEnduranceError::Cgroup)?,
    })
}

#[expect(
    clippy::too_many_arguments,
    reason = "the two cgroup versions normalize the same complete before/after evidence"
)]
#[cfg(any(target_os = "linux", test))]
fn evidence(
    limit_bytes: u64,
    baseline_current_bytes: u64,
    final_current_bytes: u64,
    peak_bytes: u64,
    limit_hits_before: u64,
    limit_hits_after: u64,
    oom_kills_before: u64,
    oom_kills_after: u64,
) -> Result<MemoryEvidence, OcrEnduranceError> {
    let limit_hit_count_delta = limit_hits_after
        .checked_sub(limit_hits_before)
        .ok_or(OcrEnduranceError::Cgroup)?;
    let oom_kill_count_delta = oom_kills_after
        .checked_sub(oom_kills_before)
        .ok_or(OcrEnduranceError::Cgroup)?;
    let peak_basis_points = u64::try_from(
        u128::from(peak_bytes).saturating_mul(BASIS_POINTS) / u128::from(limit_bytes),
    )
    .map_err(|_error| OcrEnduranceError::Cgroup)?;
    Ok(MemoryEvidence {
        limit_bytes,
        baseline_current_bytes,
        final_current_bytes,
        peak_bytes,
        limit_hit_count_delta,
        oom_kill_count_delta,
        peak_basis_points,
    })
}

#[cfg(any(target_os = "linux", test))]
fn within_peak_threshold(evidence: MemoryEvidence, maximum_basis_points: u16) -> bool {
    u128::from(evidence.peak_bytes).saturating_mul(BASIS_POINTS)
        <= u128::from(evidence.limit_bytes).saturating_mul(u128::from(maximum_basis_points))
}

#[cfg(target_os = "linux")]
fn duration_within(distribution: &DurationDistribution, p99: u64, maximum: u64) -> bool {
    distribution.count > 0 && distribution.p99 <= p99 && distribution.maximum <= maximum
}

#[cfg(any(target_os = "linux", test))]
fn distribution(mut microseconds: Vec<u64>) -> DurationDistribution {
    if microseconds.is_empty() {
        return DurationDistribution::default();
    }
    microseconds.sort_unstable();
    let sum = microseconds.iter().fold(0_u128, |total, value| {
        total.saturating_add(u128::from(*value))
    });
    let mean_microseconds = u128::try_from(microseconds.len())
        .ok()
        .filter(|count| *count > 0)
        .and_then(|count| u64::try_from(sum / count).ok())
        .unwrap_or(u64::MAX);
    DurationDistribution {
        count: microseconds.len(),
        minimum: milliseconds(microseconds.first().copied().unwrap_or_default()),
        p50: milliseconds(nearest_rank(&microseconds, 50)),
        p95: milliseconds(nearest_rank(&microseconds, 95)),
        p99: milliseconds(nearest_rank(&microseconds, 99)),
        maximum: milliseconds(*microseconds.last().unwrap_or(&0)),
        mean: milliseconds(mean_microseconds),
    }
}

#[cfg(any(target_os = "linux", test))]
fn nearest_rank(sorted: &[u64], percentile: usize) -> u64 {
    let rank = sorted.len().saturating_mul(percentile).div_ceil(100);
    sorted
        .get(rank.saturating_sub(1).min(sorted.len().saturating_sub(1)))
        .copied()
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn elapsed_microseconds(started: std::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX)
}

#[cfg(any(target_os = "linux", test))]
const fn milliseconds(microseconds: u64) -> u64 {
    microseconds.div_ceil(1_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_closed_and_requires_unique_safe_labels() {
        let valid = br#"{
          "schemaVersion": 1,
          "objects": [{
            "label": "fullhd-total",
            "objectKey": "c5-preflight/fullhd-total.png",
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "byteLength": 42,
            "mediaType": "image/png",
            "requestedScreenType": "total_assets",
            "layoutFamily": "momotetsu_2"
          }]
        }"#;
        let decoded = decode_manifest(valid).and_then(prepare_objects);
        assert!(decoded.is_ok(), "valid closed manifest must parse");

        let unknown = String::from_utf8_lossy(valid).replace(
            "\"schemaVersion\": 1,",
            "\"schemaVersion\": 1, \"unknown\": true,",
        );
        assert!(
            matches!(
                decode_manifest(unknown.as_bytes()),
                Err(OcrEnduranceError::Manifest)
            ),
            "unknown manifest fields must fail closed"
        );
    }

    #[test]
    fn distributions_use_deterministic_nearest_rank_percentiles() {
        let values = (1_u64..=100).map(|value| value * 1_000).collect();
        let result = distribution(values);
        assert_eq!(result.minimum, 1, "minimum must use milliseconds");
        assert_eq!(result.p50, 50, "p50 must use nearest rank");
        assert_eq!(result.p95, 95, "p95 must use nearest rank");
        assert_eq!(result.p99, 99, "p99 must use nearest rank");
        assert_eq!(result.maximum, 100, "maximum must use milliseconds");
        assert_eq!(result.mean, 51, "mean milliseconds must round upward");
    }

    #[test]
    fn memory_evidence_rejects_counter_regression_and_computes_headroom() {
        let result = evidence(200, 10, 20, 150, 3, 3, 1, 1);
        assert_eq!(
            result.as_ref().map(|value| value.peak_basis_points),
            Ok(7_500),
            "peak ratio must be expressed in basis points"
        );
        let measured = result.unwrap_or(MemoryEvidence {
            limit_bytes: 1,
            baseline_current_bytes: 0,
            final_current_bytes: 0,
            peak_bytes: 1,
            limit_hit_count_delta: 1,
            oom_kill_count_delta: 1,
            peak_basis_points: 10_000,
        });
        assert!(
            within_peak_threshold(measured, 7_500),
            "exactly 75 percent must satisfy a 75 percent ceiling"
        );
        assert!(
            matches!(
                evidence(200, 10, 20, 150, 3, 2, 1, 1),
                Err(OcrEnduranceError::Cgroup)
            ),
            "counter regression must invalidate evidence"
        );
    }
}
