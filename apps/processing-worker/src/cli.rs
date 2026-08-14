use std::{
    ffi::OsString,
    fmt::Display,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
    time::Duration,
};

use clap::{Args, Parser, Subcommand, ValueEnum};
use momo_ocr::OcrOutput;

use crate::{
    config::WorkerConfig,
    ocr::{
        contract::{OcrHints, RequestedScreenType},
        endurance::{
            LocalOcrEnduranceRequest, LocalOcrEnduranceThresholds, OcrEnduranceRequest,
            OcrEnduranceThresholds,
        },
        object_store::R2ObjectStoreConfig,
    },
    process::{ProbeOutcome, allocate_and_touch},
    release::{PromotionRequest, PromotionTrigger},
};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

const MAXIMUM_OCR_PILOT_IMAGE_BYTES: u64 = 3 * 1024 * 1024;

#[derive(Debug, Parser)]
#[command(
    name = "momo-analysis",
    version,
    about = "momo-result series analysis worker"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    #[command(hide = true)]
    Bootstrap {
        #[arg(last = true, required = true, num_args = 1..)]
        arguments: Vec<OsString>,
    },
    Worker,
    ReleaseAudit {
        #[arg(long)]
        require_current: bool,
        #[arg(long)]
        require_quiescent: bool,
    },
    ReleasePromote {
        #[arg(long, value_enum)]
        trigger: PromotionTrigger,
        #[arg(long)]
        operation_key: String,
        #[arg(long)]
        apply: bool,
    },
    ShadowEndurance {
        #[arg(long)]
        game_title_id: String,
        #[arg(long, default_value_t = 100)]
        runs: u32,
        #[arg(long)]
        child_memory_limit_bytes: u64,
        #[arg(long)]
        calculation_timeout_ms: u64,
        #[arg(long)]
        maximum_chunk_bytes: u64,
        #[arg(long)]
        maximum_chunk_count: u64,
        #[arg(long)]
        maximum_total_bytes: u64,
        #[arg(long)]
        maximum_file_count: u64,
        #[arg(long)]
        temporary_root: PathBuf,
        #[arg(long)]
        external_runtime_peak_file: PathBuf,
    },
    ProbeCgroupLimit {
        #[arg(long)]
        allocation_bytes: u64,
        #[arg(long, default_value_t = 5_000)]
        timeout_ms: u64,
    },
    #[command(hide = true)]
    ProbeOcrChildLifecycle {
        #[arg(long, default_value_t = 10_000)]
        timeout_ms: u64,
        #[arg(long, default_value_t = 1_000)]
        stop_grace_ms: u64,
    },
    #[command(hide = true)]
    OcrPilot {
        #[arg(long)]
        image: PathBuf,
        #[arg(long, value_enum)]
        screen_type: OcrPilotScreenType,
        #[arg(long, value_enum)]
        layout_family: Option<OcrPilotLayoutFamily>,
        #[arg(long)]
        tessdata_path: Option<PathBuf>,
    },
    #[command(hide = true)]
    OcrR2Endurance(OcrR2EnduranceArgs),
    #[command(hide = true)]
    OcrLocalEndurance(OcrLocalEnduranceArgs),
    #[command(hide = true)]
    ProbeParentDeath,
    #[command(hide = true)]
    ChildCgroupAllocate {
        #[arg(long)]
        allocation_bytes: u64,
    },
    #[command(hide = true)]
    ChildOcr {
        #[arg(long)]
        tessdata_path: Option<PathBuf>,
    },
    #[command(hide = true)]
    ChildWait {
        #[arg(long)]
        parent_liveness_fd: i32,
        #[arg(long)]
        parent_liveness_timeout_ms: u64,
    },
    #[command(hide = true)]
    ChildCompute {
        #[arg(long)]
        game_title_id: String,
        #[arg(long)]
        input_revision: i64,
        #[arg(long)]
        artifact_id: String,
        #[arg(long)]
        output_directory: PathBuf,
        #[arg(long)]
        maximum_chunk_bytes: u64,
        #[arg(long)]
        maximum_chunk_count: u64,
        #[arg(long)]
        maximum_total_bytes: u64,
        #[arg(long)]
        maximum_file_count: u64,
        #[arg(long)]
        parent_liveness_fd: i32,
        #[arg(long)]
        parent_liveness_timeout_ms: u64,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum OcrPilotScreenType {
    #[value(name = "total_assets")]
    TotalAssets,
    #[value(name = "revenue")]
    Revenue,
    #[value(name = "incident_log")]
    IncidentLog,
}

impl From<OcrPilotScreenType> for RequestedScreenType {
    fn from(value: OcrPilotScreenType) -> Self {
        match value {
            OcrPilotScreenType::TotalAssets => Self::TotalAssets,
            OcrPilotScreenType::Revenue => Self::Revenue,
            OcrPilotScreenType::IncidentLog => Self::IncidentLog,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum OcrPilotLayoutFamily {
    #[value(name = "reiwa")]
    Reiwa,
    #[value(name = "world")]
    World,
    #[value(name = "momotetsu_2")]
    Momotetsu2,
}

impl OcrPilotLayoutFamily {
    const fn wire(self) -> &'static str {
        match self {
            Self::Reiwa => "reiwa",
            Self::World => "world",
            Self::Momotetsu2 => "momotetsu_2",
        }
    }
}

#[derive(Debug, Args)]
struct OcrR2EnduranceArgs {
    #[arg(long)]
    manifest: PathBuf,
    #[arg(long, default_value_t = 100)]
    runs: u32,
    #[arg(long, default_value_t = 201_326_592)]
    child_memory_limit_bytes: u64,
    #[arg(long, default_value_t = 536_870_912)]
    expected_runtime_memory_limit_bytes: u64,
    #[arg(long, default_value_t = 30_000)]
    ocr_timeout_ms: u64,
    #[arg(long, default_value_t = 1_000)]
    stop_grace_ms: u64,
    #[arg(long, default_value_t = 10_000)]
    r2_operation_timeout_ms: u64,
    #[arg(long, default_value_t = 5_000)]
    r2_attempt_timeout_ms: u64,
    #[arg(long, default_value_t = 2)]
    r2_maximum_attempts: u32,
    #[arg(long, default_value_t = 7_500)]
    maximum_child_peak_basis_points: u16,
    #[arg(long, default_value_t = 7_500)]
    maximum_runtime_peak_basis_points: u16,
    #[arg(long, default_value_t = 2_000)]
    maximum_download_p99_ms: u64,
    #[arg(long, default_value_t = 5_000)]
    maximum_download_ms: u64,
    #[arg(long, default_value_t = 5_000)]
    maximum_ocr_p99_ms: u64,
    #[arg(long, default_value_t = 10_000)]
    maximum_ocr_ms: u64,
    #[arg(long, default_value_t = 15_000)]
    maximum_total_ms: u64,
    #[arg(long)]
    require_full_hd: bool,
    #[arg(long)]
    require_sub_full_hd: bool,
}

#[derive(Debug, Args)]
struct OcrLocalEnduranceArgs {
    #[arg(long)]
    manifest: PathBuf,
    #[arg(long, default_value_t = 100)]
    runs: u32,
    #[arg(long, default_value_t = 201_326_592)]
    child_memory_limit_bytes: u64,
    #[arg(long, default_value_t = 536_870_912)]
    expected_runtime_memory_limit_bytes: u64,
    #[arg(long, default_value_t = 30_000)]
    ocr_timeout_ms: u64,
    #[arg(long, default_value_t = 600_000)]
    maximum_endurance_ms: u64,
    #[arg(long, default_value_t = 1_000)]
    stop_grace_ms: u64,
    #[arg(long, default_value_t = 7_500)]
    maximum_child_peak_basis_points: u16,
    #[arg(long, default_value_t = 7_500)]
    maximum_runtime_peak_basis_points: u16,
    #[arg(long, default_value_t = 100)]
    maximum_input_p99_ms: u64,
    #[arg(long, default_value_t = 500)]
    maximum_input_ms: u64,
    #[arg(long, default_value_t = 5_000)]
    maximum_ocr_p99_ms: u64,
    #[arg(long, default_value_t = 10_000)]
    maximum_ocr_ms: u64,
    #[arg(long, default_value_t = 15_000)]
    maximum_total_ms: u64,
    #[arg(long)]
    require_full_hd: bool,
    #[arg(long)]
    require_sub_full_hd: bool,
}

/// Parses the process command line and runs the selected worker operation.
pub async fn entrypoint() -> ExitCode {
    let cli = Cli::parse();
    match &cli.command {
        Command::Bootstrap { arguments } => {
            return match crate::process::bootstrap_and_exec(arguments) {
                Ok(()) => ExitCode::SUCCESS,
                Err(_error) => ExitCode::FAILURE,
            };
        }
        Command::ChildCgroupAllocate { allocation_bytes } => {
            if crate::process::wait_for_child_start_barrier().is_err() {
                return exit_code(crate::process::CHILD_START_BARRIER_FAILED_EXIT_CODE);
            }
            return exit_code(allocate_and_touch(*allocation_bytes));
        }
        Command::ChildOcr { tessdata_path } => {
            return exit_code(crate::child::ocr::execute(tessdata_path.clone()));
        }
        Command::ChildCompute {
            game_title_id,
            input_revision,
            artifact_id,
            output_directory,
            maximum_chunk_bytes,
            maximum_chunk_count,
            maximum_total_bytes,
            maximum_file_count,
            parent_liveness_fd,
            parent_liveness_timeout_ms,
        } => {
            if crate::process::wait_for_child_start_barrier().is_err() {
                return exit_code(crate::process::CHILD_START_BARRIER_FAILED_EXIT_CODE);
            }
            return exit_code(
                crate::child::execute(&crate::child::ChildComputeRequest {
                    request: momo_analysis_core::child::AnalysisChildRequest {
                        game_title_id: game_title_id.clone(),
                        input_revision: *input_revision,
                        artifact_id: artifact_id.clone(),
                    },
                    output_directory,
                    maximum_chunk_bytes: *maximum_chunk_bytes,
                    maximum_chunk_count: *maximum_chunk_count,
                    maximum_total_bytes: *maximum_total_bytes,
                    maximum_file_count: *maximum_file_count,
                    parent_liveness_fd: *parent_liveness_fd,
                    parent_liveness_timeout: Duration::from_millis(*parent_liveness_timeout_ms),
                })
                .await,
            );
        }
        Command::Worker
        | Command::ReleaseAudit { .. }
        | Command::ReleasePromote { .. }
        | Command::ShadowEndurance { .. }
        | Command::ProbeCgroupLimit { .. }
        | Command::ProbeOcrChildLifecycle { .. }
        | Command::OcrPilot { .. }
        | Command::OcrR2Endurance(_)
        | Command::OcrLocalEndurance(_)
        | Command::ProbeParentDeath
        | Command::ChildWait { .. } => {}
    }

    initialize_logging();
    match run(cli.command).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            error!(
                event = "analysis_command_failed",
                error = %message,
                "analysis worker command failed"
            );
            ExitCode::FAILURE
        }
    }
}

async fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Worker => run_worker().await,
        Command::ReleaseAudit {
            require_current,
            require_quiescent,
        } => release_audit(require_current, require_quiescent).await,
        Command::ReleasePromote {
            trigger,
            operation_key,
            apply,
        } => release_promote(trigger, &operation_key, apply).await,
        Command::ShadowEndurance {
            game_title_id,
            runs,
            child_memory_limit_bytes,
            calculation_timeout_ms,
            maximum_chunk_bytes,
            maximum_chunk_count,
            maximum_total_bytes,
            maximum_file_count,
            temporary_root,
            external_runtime_peak_file,
        } => {
            shadow_endurance(crate::shadow::ShadowRequest {
                game_title_id,
                runs,
                child_memory_limit_bytes,
                calculation_timeout: Duration::from_millis(calculation_timeout_ms),
                maximum_chunk_bytes,
                maximum_chunk_count,
                maximum_total_bytes,
                maximum_file_count,
                temporary_root,
                external_runtime_peak_file,
            })
            .await
        }
        Command::ProbeCgroupLimit {
            allocation_bytes,
            timeout_ms,
        } => run_cgroup_hard_limit_probe(allocation_bytes, timeout_ms).await,
        Command::ProbeOcrChildLifecycle {
            timeout_ms,
            stop_grace_ms,
        } => run_ocr_child_lifecycle_probe(timeout_ms, stop_grace_ms).await,
        Command::OcrPilot {
            image,
            screen_type,
            layout_family,
            tessdata_path,
        } => run_ocr_pilot(&image, screen_type, layout_family, tessdata_path).await,
        Command::OcrR2Endurance(arguments) => run_ocr_r2_endurance(arguments).await,
        Command::OcrLocalEndurance(arguments) => run_ocr_local_endurance(arguments).await,
        Command::ChildCgroupAllocate { .. }
        | Command::ChildOcr { .. }
        | Command::ChildCompute { .. } => Err(String::from("child command dispatch failed")),
        Command::Bootstrap { .. } => Err(String::from("bootstrap command dispatch failed")),
        Command::ProbeParentDeath => {
            let probe =
                crate::process::spawn_parent_death_probe().map_err(|error| error.to_string())?;
            write_stdout_line(probe.process_id())?;
            wait_for_shutdown().await.map_err(|error| error.to_string())
        }
        Command::ChildWait {
            parent_liveness_fd,
            parent_liveness_timeout_ms,
        } => {
            crate::process::start_parent_liveness_monitor(
                parent_liveness_fd,
                Duration::from_millis(parent_liveness_timeout_ms),
            )
            .map_err(|error| error.to_string())?;
            wait_for_shutdown().await.map_err(|error| error.to_string())
        }
    }
}

async fn run_cgroup_hard_limit_probe(allocation_bytes: u64, timeout_ms: u64) -> Result<(), String> {
    let result = crate::process::run_cgroup_hard_limit_probe(
        allocation_bytes,
        Duration::from_millis(timeout_ms),
    )
    .await
    .map_err(|error| error.to_string())?;
    write_json_line(&result)?;
    if result.outcome == ProbeOutcome::ResourceLimitEnforced && result.parent_survived {
        Ok(())
    } else {
        Err(format!("cgroup hard limit probe failed: {result:?}"))
    }
}

async fn run_ocr_child_lifecycle_probe(timeout_ms: u64, stop_grace_ms: u64) -> Result<(), String> {
    crate::ocr::probe_isolated_child_lifecycle(
        Duration::from_millis(timeout_ms),
        Duration::from_millis(stop_grace_ms),
    )
    .await
    .map_err(String::from)?;
    write_json_line(&serde_json::json!({
        "cancelledChildReaped": true,
        "followupChildCompleted": true,
        "parentSurvived": true,
    }))
}

async fn run_ocr_pilot(
    image_path: &std::path::Path,
    screen_type: OcrPilotScreenType,
    layout_family: Option<OcrPilotLayoutFamily>,
    tessdata_path: Option<PathBuf>,
) -> Result<(), String> {
    let (bytes, hints) = read_ocr_pilot_input(image_path, layout_family).await?;
    let output =
        momo_ocr::recognize_local_image_bytes(tessdata_path, &bytes, screen_type.into(), &hints)
            .map_err(|error| format!("OCR pilot failed: {error:?}"))?;
    write_ocr_pilot_output(&output)
}

async fn run_ocr_r2_endurance(arguments: OcrR2EnduranceArgs) -> Result<(), String> {
    let object_store = R2ObjectStoreConfig::new_with_session_token(
        &required_environment("SOURCE_IMAGE_R2_ENDPOINT")?,
        &required_environment("SOURCE_IMAGE_R2_BUCKET")?,
        required_environment("SOURCE_IMAGE_R2_ACCESS_KEY_ID")?,
        required_environment("SOURCE_IMAGE_R2_SECRET_ACCESS_KEY")?,
        optional_environment("SOURCE_IMAGE_R2_SESSION_TOKEN"),
        Duration::from_millis(arguments.r2_operation_timeout_ms),
        Duration::from_millis(arguments.r2_attempt_timeout_ms),
        arguments.r2_maximum_attempts,
    )
    .map_err(|error| error.to_string())?;
    let report = crate::ocr::endurance::run_r2_endurance(&OcrEnduranceRequest {
        manifest_path: arguments.manifest,
        runs: arguments.runs,
        child_memory_limit_bytes: arguments.child_memory_limit_bytes,
        expected_runtime_memory_limit_bytes: arguments.expected_runtime_memory_limit_bytes,
        ocr_timeout: Duration::from_millis(arguments.ocr_timeout_ms),
        stop_grace: Duration::from_millis(arguments.stop_grace_ms),
        object_store,
        thresholds: OcrEnduranceThresholds {
            maximum_child_peak_basis_points: arguments.maximum_child_peak_basis_points,
            maximum_runtime_peak_basis_points: arguments.maximum_runtime_peak_basis_points,
            maximum_download_p99_milliseconds: arguments.maximum_download_p99_ms,
            maximum_download_milliseconds: arguments.maximum_download_ms,
            maximum_ocr_p99_milliseconds: arguments.maximum_ocr_p99_ms,
            maximum_ocr_milliseconds: arguments.maximum_ocr_ms,
            maximum_total_milliseconds: arguments.maximum_total_ms,
        },
        require_full_hd: arguments.require_full_hd,
        require_sub_full_hd: arguments.require_sub_full_hd,
    })
    .await
    .map_err(|error| error.to_string())?;
    let passed = report.passed();
    write_json_line(&report)?;
    if passed {
        Ok(())
    } else {
        Err(String::from("R2 OCR endurance gate failed"))
    }
}

async fn run_ocr_local_endurance(arguments: OcrLocalEnduranceArgs) -> Result<(), String> {
    let report = crate::ocr::endurance::run_local_endurance(&LocalOcrEnduranceRequest {
        manifest_path: arguments.manifest,
        runs: arguments.runs,
        child_memory_limit_bytes: arguments.child_memory_limit_bytes,
        expected_runtime_memory_limit_bytes: arguments.expected_runtime_memory_limit_bytes,
        ocr_timeout: Duration::from_millis(arguments.ocr_timeout_ms),
        maximum_endurance: Duration::from_millis(arguments.maximum_endurance_ms),
        stop_grace: Duration::from_millis(arguments.stop_grace_ms),
        thresholds: LocalOcrEnduranceThresholds {
            maximum_child_peak_basis_points: arguments.maximum_child_peak_basis_points,
            maximum_runtime_peak_basis_points: arguments.maximum_runtime_peak_basis_points,
            maximum_input_p99_milliseconds: arguments.maximum_input_p99_ms,
            maximum_input_milliseconds: arguments.maximum_input_ms,
            maximum_ocr_p99_milliseconds: arguments.maximum_ocr_p99_ms,
            maximum_ocr_milliseconds: arguments.maximum_ocr_ms,
            maximum_total_milliseconds: arguments.maximum_total_ms,
        },
        require_full_hd: arguments.require_full_hd,
        require_sub_full_hd: arguments.require_sub_full_hd,
    })
    .await
    .map_err(|error| error.to_string())?;
    let passed = report.passed();
    write_json_line(&report)?;
    if passed {
        Ok(())
    } else {
        Err(String::from("local OCR endurance gate failed"))
    }
}

fn required_environment(name: &'static str) -> Result<String, String> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        Ok(_value) => Err(format!("required environment variable {name} is missing")),
        Err(_error) => Err(format!("required environment variable {name} is missing")),
    }
}

fn optional_environment(name: &'static str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

async fn read_ocr_pilot_input(
    image_path: &std::path::Path,
    layout_family: Option<OcrPilotLayoutFamily>,
) -> Result<(Vec<u8>, OcrHints), String> {
    let metadata = tokio::fs::metadata(image_path)
        .await
        .map_err(|_error| String::from("OCR pilot image metadata could not be read"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAXIMUM_OCR_PILOT_IMAGE_BYTES
    {
        return Err(String::from("OCR pilot image violates the byte bound"));
    }
    let bytes = tokio::fs::read(image_path)
        .await
        .map_err(|_error| String::from("OCR pilot image could not be read"))?;
    let hints = layout_family.map_or_else(
        || Ok(OcrHints::default()),
        |family| {
            serde_json::from_value(serde_json::json!({ "layoutFamily": family.wire() }))
                .map_err(|_error| String::from("OCR pilot hints could not be constructed"))
        },
    )?;
    Ok((bytes, hints))
}

fn write_ocr_pilot_output(output: &OcrOutput) -> Result<(), String> {
    write_json_line(&serde_json::json!({
        "detectedScreenType": output.detected_screen_type.wire(),
        "profileId": output.profile_id,
        "result": output.payload,
        "warnings": output.warnings,
        "timingsMilliseconds": output.timings_milliseconds,
    }))
}

async fn release_audit(require_current: bool, require_quiescent: bool) -> Result<(), String> {
    let report = crate::release::audit_completeness(require_current, require_quiescent)
        .await
        .map_err(|error| error.to_string())?;
    write_json_line(&report)?;
    if report.passed {
        Ok(())
    } else {
        Err(String::from("analysis release completeness audit failed"))
    }
}

async fn release_promote(
    trigger: PromotionTrigger,
    operation_key: &str,
    apply: bool,
) -> Result<(), String> {
    let report = crate::release::promote(&PromotionRequest {
        trigger,
        operation_key,
        apply,
    })
    .await
    .map_err(|error| error.to_string())?;
    write_json_line(&report)?;
    Ok(())
}

async fn shadow_endurance(request: crate::shadow::ShadowRequest) -> Result<(), String> {
    let report = crate::shadow::run(&request)
        .await
        .map_err(|error| error.to_string())?;
    write_json_line(&report)?;
    Ok(())
}

fn write_json_line(value: &impl serde::Serialize) -> Result<(), String> {
    let encoded = serde_json::to_string(value).map_err(|error| error.to_string())?;
    write_stdout_line(encoded)
}

fn write_stdout_line(value: impl Display) -> Result<(), String> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    writeln!(output, "{value}").map_err(|error| error.to_string())
}

fn exit_code(code: i32) -> ExitCode {
    u8::try_from(code).map_or(ExitCode::FAILURE, ExitCode::from)
}

async fn run_worker() -> Result<(), String> {
    let config = WorkerConfig::from_environment().map_err(|error| error.to_string())?;
    let runtime_plan = crate::supervisor::WorkerRuntimePlan::from_environment(&config)
        .map_err(|error| error.to_string())?;
    info!(
        event = "analysis_configuration_accepted",
        publication_mode = ?config.publication_mode,
        analysis_enabled = runtime_plan.series_analysis_enabled(),
        ocr_v2_enabled = runtime_plan.ocr_enabled(),
        "combined worker configuration accepted"
    );
    let (shutdown_sender, shutdown_receiver) = tokio::sync::watch::channel(false);
    let supervised_runtime = crate::supervisor::run(runtime_plan, shutdown_receiver);
    tokio::pin!(supervised_runtime);
    tokio::select! {
        result = &mut supervised_runtime => result.map_err(|error| error.to_string()),
        signal = wait_for_shutdown() => {
            signal.map_err(|error| error.to_string())?;
            if let Err(_receiver_closed) = shutdown_sender.send(true) {}
            supervised_runtime.await.map_err(|error| error.to_string())
        }
    }
}

async fn wait_for_shutdown() -> Result<(), io::Error> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            _ = terminate.recv() => {}
            result = tokio::signal::ctrl_c() => result?,
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await
    }
}

fn initialize_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let text_format =
        std::env::var("MOMO_LOG_FORMAT").is_ok_and(|value| value.eq_ignore_ascii_case("text"));
    if text_format {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .compact()
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .with_current_span(true)
            .with_span_list(false)
            .init();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocr_pilot_rejects_auto_and_accepts_only_explicit_screen_types() {
        let base = ["momo-analysis", "ocr-pilot", "--image", "sample.png"];
        for screen_type in ["total_assets", "revenue", "incident_log"] {
            let arguments = base
                .into_iter()
                .chain(["--screen-type", screen_type])
                .collect::<Vec<_>>();
            assert!(Cli::try_parse_from(arguments).is_ok(), "{screen_type}");
        }
        let auto = base
            .into_iter()
            .chain(["--screen-type", "auto"])
            .collect::<Vec<_>>();
        assert!(Cli::try_parse_from(auto).is_err());
    }

    #[test]
    fn local_endurance_accepts_an_explicit_wall_time_budget() {
        let parsed = Cli::try_parse_from([
            "momo-analysis",
            "ocr-local-endurance",
            "--manifest",
            "/var/lib/momo-analysis/preflight/manifest.json",
            "--maximum-endurance-ms",
            "1234",
        ]);
        let maximum_endurance_ms = match parsed {
            Ok(Cli {
                command: Command::OcrLocalEndurance(arguments),
            }) => Some(arguments.maximum_endurance_ms),
            _ => None,
        };
        assert_eq!(maximum_endurance_ms, Some(1_234));
    }
}
