use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};

use super::{DurationDistribution, MemoryEvidence, OcrEnduranceError, RunTiming, valid_label};
use crate::ocr::contract::{OcrHints, RequestedScreenType};

#[cfg(target_os = "linux")]
use super::{
    distribution, domain_failure_kind, elapsed_microseconds, evidence, milliseconds,
    runtime_cgroup_evidence, vm_memory::VmMemorySampler, within_peak_threshold,
};
#[cfg(target_os = "linux")]
use image::ImageReader;
#[cfg(target_os = "linux")]
use std::io::Cursor;
#[cfg(target_os = "linux")]
use tokio::time;
#[cfg(target_os = "linux")]
use tracing::info;

#[cfg(target_os = "linux")]
const MAXIMUM_LOCAL_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES: u64 = 64 * 1024;
const MAXIMUM_IMAGES: usize = 24;
const MAXIMUM_RUNS: u32 = 1_000;
const MAXIMUM_ENDURANCE_DURATION: Duration = Duration::from_hours(1);
const PREFLIGHT_ROOT: &str = "/var/lib/momo-analysis/preflight";

pub struct LocalOcrEnduranceRequest {
    pub manifest_path: PathBuf,
    pub runs: u32,
    pub child_memory_limit_bytes: u64,
    pub expected_runtime_memory_limit_bytes: u64,
    pub ocr_timeout: Duration,
    pub maximum_endurance: Duration,
    pub stop_grace: Duration,
    pub thresholds: LocalOcrEnduranceThresholds,
    pub require_full_hd: bool,
    pub require_sub_full_hd: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOcrEnduranceThresholds {
    pub maximum_child_peak_basis_points: u16,
    pub maximum_runtime_peak_basis_points: u16,
    pub maximum_input_p99_milliseconds: u64,
    pub maximum_input_milliseconds: u64,
    pub maximum_ocr_p99_milliseconds: u64,
    pub maximum_ocr_milliseconds: u64,
    pub maximum_total_milliseconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOcrEnduranceReport {
    schema_version: u8,
    mode: &'static str,
    runs_requested: u32,
    runs_completed: u32,
    successful_runs: u32,
    maximum_endurance_milliseconds: u64,
    elapsed_milliseconds: u64,
    stop_reason: Option<&'static str>,
    images_configured: usize,
    image_runs: BTreeMap<String, u32>,
    screen_type_runs: BTreeMap<String, u32>,
    dimension_class_runs: BTreeMap<String, u32>,
    input_duration_milliseconds: DurationDistribution,
    ocr_duration_milliseconds: DurationDistribution,
    total_duration_milliseconds: DurationDistribution,
    first_run: Option<RunTiming>,
    failures: LocalFailureCounts,
    child_memory: MemoryEvidence,
    runtime_memory: super::vm_memory::VmMemoryEvidence,
    runtime_cgroup_memory: super::RuntimeCgroupEvidence,
    thresholds: LocalOcrEnduranceThresholds,
    require_full_hd: bool,
    require_sub_full_hd: bool,
    passed: bool,
}

impl LocalOcrEnduranceReport {
    #[must_use]
    pub const fn passed(&self) -> bool {
        self.passed
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFailureCounts {
    input: u32,
    child: u32,
    domain: u32,
    screen_type_mismatch: u32,
    endurance_timeout: u32,
    categories: BTreeMap<String, u32>,
}

impl LocalFailureCounts {
    #[cfg(target_os = "linux")]
    const fn total(&self) -> u32 {
        self.input
            .saturating_add(self.child)
            .saturating_add(self.domain)
            .saturating_add(self.screen_type_mismatch)
            .saturating_add(self.endurance_timeout)
    }

    #[cfg(target_os = "linux")]
    fn category(&mut self, value: &str) {
        let count = self.categories.entry(String::from(value)).or_default();
        *count = count.saturating_add(1);
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LocalManifest {
    schema_version: u8,
    images: Vec<LocalManifestImage>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LocalManifestImage {
    label: String,
    path: PathBuf,
    requested_screen_type: String,
    layout_family: String,
}

struct PreparedLocalImage {
    label: String,
    path: PathBuf,
    requested_screen_type: RequestedScreenType,
    hints: OcrHints,
}

#[cfg(target_os = "linux")]
struct LocalImageBytes {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

/// Runs actual isolated OCR against Fly-injected private files without delegating any storage
/// credential to the target runtime.
///
/// # Errors
///
/// Returns the same closed preflight categories used by the R2-backed endurance gate.
pub async fn run_local_endurance(
    request: &LocalOcrEnduranceRequest,
) -> Result<LocalOcrEnduranceReport, OcrEnduranceError> {
    validate_request(request)?;
    let manifest = read_manifest(&request.manifest_path).await?;
    let images = prepare_images(manifest)?;
    run_linux(request, images).await
}

fn validate_request(request: &LocalOcrEnduranceRequest) -> Result<(), OcrEnduranceError> {
    let thresholds = request.thresholds;
    if request.runs == 0
        || request.runs > MAXIMUM_RUNS
        || request.child_memory_limit_bytes == 0
        || request.expected_runtime_memory_limit_bytes == 0
        || request.ocr_timeout.is_zero()
        || request.maximum_endurance.is_zero()
        || request.maximum_endurance > MAXIMUM_ENDURANCE_DURATION
        || request.stop_grace.is_zero()
        || !(1..10_000).contains(&thresholds.maximum_child_peak_basis_points)
        || !(1..10_000).contains(&thresholds.maximum_runtime_peak_basis_points)
        || thresholds.maximum_input_p99_milliseconds == 0
        || thresholds.maximum_input_p99_milliseconds > thresholds.maximum_input_milliseconds
        || thresholds.maximum_ocr_p99_milliseconds == 0
        || thresholds.maximum_ocr_p99_milliseconds > thresholds.maximum_ocr_milliseconds
        || thresholds.maximum_total_milliseconds == 0
    {
        return Err(OcrEnduranceError::Configuration);
    }
    Ok(())
}

async fn read_manifest(path: &Path) -> Result<LocalManifest, OcrEnduranceError> {
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

fn decode_manifest(bytes: &[u8]) -> Result<LocalManifest, OcrEnduranceError> {
    let manifest: LocalManifest =
        serde_json::from_slice(bytes).map_err(|_error| OcrEnduranceError::Manifest)?;
    if manifest.schema_version != 1
        || manifest.images.is_empty()
        || manifest.images.len() > MAXIMUM_IMAGES
    {
        return Err(OcrEnduranceError::Manifest);
    }
    Ok(manifest)
}

fn prepare_images(manifest: LocalManifest) -> Result<Vec<PreparedLocalImage>, OcrEnduranceError> {
    let mut labels = HashSet::new();
    let mut paths = HashSet::new();
    manifest
        .images
        .into_iter()
        .map(|image| {
            if !valid_label(&image.label)
                || !safe_preflight_path(&image.path)
                || !labels.insert(image.label.clone())
                || !paths.insert(image.path.clone())
            {
                return Err(OcrEnduranceError::Manifest);
            }
            let requested_screen_type =
                RequestedScreenType::parse_wire(image.requested_screen_type.as_str())
                    .ok_or(OcrEnduranceError::Manifest)?;
            let hints = serde_json::from_value(serde_json::json!({
                "layoutFamily": image.layout_family,
            }))
            .map_err(|_error| OcrEnduranceError::Manifest)?;
            Ok(PreparedLocalImage {
                label: image.label,
                path: image.path,
                requested_screen_type,
                hints,
            })
        })
        .collect()
}

fn safe_preflight_path(path: &Path) -> bool {
    path.starts_with(PREFLIGHT_ROOT)
        && path != Path::new(PREFLIGHT_ROOT)
        && path
            .components()
            .all(|component| matches!(component, Component::RootDir | Component::Normal(_)))
}

#[cfg(target_os = "linux")]
#[expect(
    clippy::too_many_lines,
    reason = "the release-only endurance runner keeps one explicit serial measurement state machine so partial failure evidence is emitted consistently"
)]
async fn run_linux(
    request: &LocalOcrEnduranceRequest,
    images: Vec<PreparedLocalImage>,
) -> Result<LocalOcrEnduranceReport, OcrEnduranceError> {
    use std::time::Instant;

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
    let vm_memory = VmMemorySampler::start(request.expected_runtime_memory_limit_bytes).await?;

    let run_capacity =
        usize::try_from(request.runs).map_err(|_error| OcrEnduranceError::Configuration)?;
    let mut input_durations = Vec::with_capacity(run_capacity);
    let mut ocr_durations = Vec::with_capacity(run_capacity);
    let mut total_durations = Vec::with_capacity(run_capacity);
    let mut first_run = None;
    let mut successful_runs = 0_u32;
    let mut runs_completed = 0_u32;
    let mut stop_reason = None;
    let mut failures = LocalFailureCounts::default();
    let mut image_runs = BTreeMap::<String, u32>::new();
    let mut screen_type_runs = BTreeMap::<String, u32>::new();
    let mut dimension_class_runs = BTreeMap::<String, u32>::new();
    let endurance_started = Instant::now();
    let maximum_endurance_milliseconds = duration_milliseconds(request.maximum_endurance);
    let effective_ocr_timeout = request.ocr_timeout.min(Duration::from_millis(
        request.thresholds.maximum_ocr_milliseconds,
    ));
    info!(
        event = "ocr_local_endurance_started",
        runs_requested = request.runs,
        images_configured = images.len(),
        maximum_endurance_milliseconds,
        ocr_timeout_milliseconds = duration_milliseconds(request.ocr_timeout),
        effective_ocr_timeout_milliseconds = duration_milliseconds(effective_ocr_timeout),
        failure_policy = "fail_fast",
        "local OCR endurance gate started"
    );

    for run_index in 0..request.runs {
        let Some((input_timeout, input_limited_by_endurance)) = bounded_phase_timeout(
            endurance_started.elapsed(),
            request.maximum_endurance,
            Duration::from_millis(request.thresholds.maximum_input_milliseconds),
        ) else {
            failures.endurance_timeout = failures.endurance_timeout.saturating_add(1);
            failures.category("endurance_timeout");
            stop_reason = Some("endurance_timeout");
            break;
        };
        let index = usize::try_from(run_index)
            .map_err(|_error| OcrEnduranceError::Configuration)?
            % images.len();
        let image = images.get(index).ok_or(OcrEnduranceError::Configuration)?;
        increment(&mut image_runs, &image.label);
        increment(&mut screen_type_runs, image.requested_screen_type.wire());

        let total_started = Instant::now();
        let input_started = Instant::now();
        let loaded = match time::timeout(input_timeout, read_local_image(&image.path)).await {
            Ok(Ok(loaded)) => loaded,
            Ok(Err(kind)) => {
                let input = elapsed_microseconds(input_started);
                input_durations.push(input);
                let total = elapsed_microseconds(total_started);
                total_durations.push(total);
                failures.input = failures.input.saturating_add(1);
                failures.category(kind);
                stop_reason = Some(kind);
                runs_completed = runs_completed.saturating_add(1);
                log_local_progress(
                    request,
                    runs_completed,
                    image,
                    "unavailable",
                    kind,
                    input,
                    0,
                    total,
                    endurance_started.elapsed(),
                    successful_runs,
                );
                break;
            }
            Err(_elapsed) => {
                let input = elapsed_microseconds(input_started);
                let total = elapsed_microseconds(total_started);
                input_durations.push(input);
                total_durations.push(total);
                let kind = if input_limited_by_endurance {
                    failures.endurance_timeout = failures.endurance_timeout.saturating_add(1);
                    "endurance_timeout"
                } else {
                    failures.input = failures.input.saturating_add(1);
                    "local_input_timeout"
                };
                failures.category(kind);
                stop_reason = Some(kind);
                runs_completed = runs_completed.saturating_add(1);
                log_local_progress(
                    request,
                    runs_completed,
                    image,
                    "unavailable",
                    kind,
                    input,
                    0,
                    total,
                    endurance_started.elapsed(),
                    successful_runs,
                );
                break;
            }
        };
        let input = elapsed_microseconds(input_started);
        input_durations.push(input);
        let dimension_class = if loaded.width == 1_920 && loaded.height == 1_080 {
            "full_hd"
        } else {
            "sub_full_hd"
        };
        increment(&mut dimension_class_runs, dimension_class);

        let Some((ocr_timeout, ocr_limited_by_endurance)) = bounded_phase_timeout(
            endurance_started.elapsed(),
            request.maximum_endurance,
            effective_ocr_timeout,
        ) else {
            let total = elapsed_microseconds(total_started);
            total_durations.push(total);
            failures.endurance_timeout = failures.endurance_timeout.saturating_add(1);
            failures.category("endurance_timeout");
            stop_reason = Some("endurance_timeout");
            runs_completed = runs_completed.saturating_add(1);
            log_local_progress(
                request,
                runs_completed,
                image,
                dimension_class,
                "endurance_timeout",
                input,
                0,
                total,
                endurance_started.elapsed(),
                successful_runs,
            );
            break;
        };
        let ocr_started = Instant::now();
        let outcome = crate::ocr::analyze_isolated_local_image_bytes(
            &loaded.bytes,
            image.requested_screen_type,
            &image.hints,
            None,
            ocr_timeout,
            request.stop_grace,
        )
        .await;
        let ocr = elapsed_microseconds(ocr_started);
        ocr_durations.push(ocr);
        let total = elapsed_microseconds(total_started);
        total_durations.push(total);
        if first_run.is_none() {
            first_run = Some(RunTiming {
                object_label: image.label.clone(),
                download_milliseconds: milliseconds(input),
                ocr_milliseconds: milliseconds(ocr),
                total_milliseconds: milliseconds(total),
            });
        }
        let outcome_kind = match outcome {
            Err(kind) if ocr_limited_by_endurance && kind == "ocr_child_pilot_timeout" => {
                failures.endurance_timeout = failures.endurance_timeout.saturating_add(1);
                failures.category("endurance_timeout");
                "endurance_timeout"
            }
            Err(kind) => {
                failures.child = failures.child.saturating_add(1);
                failures.category(kind);
                kind
            }
            Ok(Err(failure)) => {
                failures.domain = failures.domain.saturating_add(1);
                let kind = domain_failure_kind(failure);
                failures.category(kind);
                kind
            }
            Ok(Ok(output)) if output.detected_screen_type != image.requested_screen_type => {
                failures.screen_type_mismatch = failures.screen_type_mismatch.saturating_add(1);
                failures.category("screen_type_mismatch");
                "screen_type_mismatch"
            }
            Ok(Ok(_output)) => {
                successful_runs = successful_runs.saturating_add(1);
                "success"
            }
        };
        if outcome_kind != "success" {
            stop_reason = Some(outcome_kind);
        }
        runs_completed = runs_completed.saturating_add(1);
        log_local_progress(
            request,
            runs_completed,
            image,
            dimension_class,
            outcome_kind,
            input,
            ocr,
            total,
            endurance_started.elapsed(),
            successful_runs,
        );
        if stop_reason.is_some() {
            break;
        }
    }

    if let Some(reason) = stop_reason {
        info!(
            event = "ocr_local_endurance_stopped",
            reason,
            runs_completed,
            runs_requested = request.runs,
            elapsed_milliseconds = duration_milliseconds(endurance_started.elapsed()),
            "local OCR endurance gate stopped early"
        );
    }
    let elapsed_milliseconds = duration_milliseconds(endurance_started.elapsed());
    cgroup
        .ensure_empty()
        .map_err(|_error| OcrEnduranceError::Cleanup)?;
    let child_after = cgroup
        .snapshot()
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let runtime_after = cgroup
        .runtime_snapshot()
        .map_err(|_error| OcrEnduranceError::Cgroup)?;
    let child_memory = evidence(
        request.child_memory_limit_bytes,
        child_before.current_bytes,
        child_after.current_bytes,
        child_after.peak_bytes,
        child_before.limit_hit_count,
        child_after.limit_hit_count,
        child_before.oom_kill_count,
        child_after.oom_kill_count,
    )?;
    let runtime_cgroup_memory = runtime_cgroup_evidence(runtime_before, runtime_after)?;
    let runtime_memory = vm_memory.finish().await?;
    let input_distribution = distribution(input_durations);
    let ocr_distribution = distribution(ocr_durations);
    let total_distribution = distribution(total_durations);
    let passed = runs_completed == request.runs
        && successful_runs == request.runs
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
            &input_distribution,
            request.thresholds.maximum_input_p99_milliseconds,
            request.thresholds.maximum_input_milliseconds,
        )
        && duration_within(
            &ocr_distribution,
            request.thresholds.maximum_ocr_p99_milliseconds,
            request.thresholds.maximum_ocr_milliseconds,
        )
        && total_distribution.maximum <= request.thresholds.maximum_total_milliseconds
        && images
            .iter()
            .all(|image| image_runs.get(&image.label).copied().unwrap_or_default() > 0)
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

    Ok(LocalOcrEnduranceReport {
        schema_version: 4,
        mode: "local_file_isolated_ocr",
        runs_requested: request.runs,
        runs_completed,
        successful_runs,
        maximum_endurance_milliseconds,
        elapsed_milliseconds,
        stop_reason,
        images_configured: images.len(),
        image_runs,
        screen_type_runs,
        dimension_class_runs,
        input_duration_milliseconds: input_distribution,
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
#[expect(
    clippy::too_many_arguments,
    reason = "one progress event records the complete bounded phase outcome without OCR content"
)]
fn log_local_progress(
    request: &LocalOcrEnduranceRequest,
    runs_completed: u32,
    image: &PreparedLocalImage,
    dimension_class: &str,
    outcome: &str,
    input_microseconds: u64,
    ocr_microseconds: u64,
    total_microseconds: u64,
    elapsed: Duration,
    successful_runs: u32,
) {
    info!(
        event = "ocr_local_endurance_progress",
        runs_completed,
        runs_requested = request.runs,
        successful_runs,
        image_label = %image.label,
        requested_screen_type = image.requested_screen_type.wire(),
        dimension_class = %dimension_class,
        outcome = %outcome,
        input_milliseconds = milliseconds(input_microseconds),
        ocr_milliseconds = milliseconds(ocr_microseconds),
        total_milliseconds = milliseconds(total_microseconds),
        elapsed_milliseconds = duration_milliseconds(elapsed),
        "local OCR endurance run completed"
    );
}

#[cfg(any(target_os = "linux", test))]
fn bounded_phase_timeout(
    elapsed: Duration,
    maximum_endurance: Duration,
    phase_timeout: Duration,
) -> Option<(Duration, bool)> {
    let remaining = maximum_endurance.checked_sub(elapsed)?;
    if remaining.is_zero() || phase_timeout.is_zero() {
        return None;
    }
    Some((remaining.min(phase_timeout), remaining < phase_timeout))
}

#[cfg(target_os = "linux")]
fn duration_milliseconds(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(target_os = "linux")]
const fn duration_within(distribution: &DurationDistribution, p99: u64, maximum: u64) -> bool {
    distribution.count > 0 && distribution.p99 <= p99 && distribution.maximum <= maximum
}

#[cfg(target_os = "linux")]
fn increment(counts: &mut BTreeMap<String, u32>, key: &str) {
    let count = counts.entry(String::from(key)).or_default();
    *count = count.saturating_add(1);
}

#[cfg(target_os = "linux")]
async fn read_local_image(path: &Path) -> Result<LocalImageBytes, &'static str> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_error| "local_input_metadata")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAXIMUM_LOCAL_IMAGE_BYTES {
        return Err("local_input_bounds");
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_error| "local_input_read")?;
    let reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_error| "local_input_format")?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_error| "local_input_dimensions")?;
    if width == 0 || height == 0 || width > 1_920 || height > 1_080 {
        return Err("local_input_dimensions");
    }
    Ok(LocalImageBytes {
        bytes,
        width,
        height,
    })
}

#[cfg(not(target_os = "linux"))]
async fn run_linux(
    _request: &LocalOcrEnduranceRequest,
    images: Vec<PreparedLocalImage>,
) -> Result<LocalOcrEnduranceReport, OcrEnduranceError> {
    for image in images {
        drop((
            image.label,
            image.path,
            image.requested_screen_type,
            image.hints,
        ));
    }
    std::future::ready(Err(OcrEnduranceError::UnsupportedPlatform)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_manifest_is_closed_and_confined_to_preflight_root() {
        let valid = br#"{
          "schemaVersion": 1,
          "images": [{
            "label": "fullhd-total",
            "path": "/var/lib/momo-analysis/preflight/fullhd-total.png",
            "requestedScreenType": "total_assets",
            "layoutFamily": "momotetsu_2"
          }]
        }"#;
        assert!(
            decode_manifest(valid).and_then(prepare_images).is_ok(),
            "valid local manifest must parse"
        );
        let escaped = String::from_utf8_lossy(valid).replace(
            "/var/lib/momo-analysis/preflight/fullhd-total.png",
            "/var/lib/momo-analysis/preflight/../outside.png",
        );
        assert!(
            matches!(
                decode_manifest(escaped.as_bytes()).and_then(prepare_images),
                Err(OcrEnduranceError::Manifest)
            ),
            "parent traversal must fail closed"
        );
    }

    #[test]
    fn phase_timeout_never_exceeds_the_remaining_endurance_budget() {
        assert_eq!(
            bounded_phase_timeout(
                Duration::from_secs(2),
                Duration::from_secs(10),
                Duration::from_secs(3),
            ),
            Some((Duration::from_secs(3), false))
        );
        assert_eq!(
            bounded_phase_timeout(
                Duration::from_secs(9),
                Duration::from_secs(10),
                Duration::from_secs(3),
            ),
            Some((Duration::from_secs(1), true))
        );
        assert_eq!(
            bounded_phase_timeout(
                Duration::from_secs(10),
                Duration::from_secs(10),
                Duration::from_secs(3),
            ),
            None
        );
    }
}
