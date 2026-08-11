use std::{
    fmt::Display,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
    time::Duration,
};

use clap::{Parser, Subcommand, ValueEnum};
use momo_analysis::{
    config::{PublicationMode, WorkerConfig, WorkerRuntimeConfig},
    ocr::{
        NativeOcrEngine,
        contract::{OcrHints, RequestedScreenType},
    },
    process::{ProbeOutcome, allocate_and_touch, run_hard_limit_probe},
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
    Worker,
    ReleaseDependencyProbe,
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
    ProbeHardLimit {
        #[arg(long)]
        limit_bytes: u64,
        #[arg(long)]
        allocation_bytes: u64,
        #[arg(long, default_value_t = 5_000)]
        timeout_ms: u64,
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
    ProbeParentDeath,
    #[command(hide = true)]
    ChildAllocate {
        #[arg(long)]
        allocation_bytes: u64,
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

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    match &cli.command {
        Command::ChildAllocate { allocation_bytes } => {
            return exit_code(allocate_and_touch(*allocation_bytes));
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
            return exit_code(
                momo_analysis::child::execute(&momo_analysis::child::ChildComputeRequest {
                    game_title_id,
                    input_revision: *input_revision,
                    artifact_id,
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
        | Command::ReleaseDependencyProbe
        | Command::ReleaseAudit { .. }
        | Command::ReleasePromote { .. }
        | Command::ShadowEndurance { .. }
        | Command::ProbeHardLimit { .. }
        | Command::OcrPilot { .. }
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
        Command::ReleaseDependencyProbe => {
            let report = momo_analysis::release::probe_dependencies()
                .await
                .map_err(|error| error.to_string())?;
            write_json_line(&report)
        }
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
            shadow_endurance(momo_analysis::shadow::ShadowRequest {
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
        Command::ProbeHardLimit {
            limit_bytes,
            allocation_bytes,
            timeout_ms,
        } => {
            let result = run_hard_limit_probe(
                limit_bytes,
                allocation_bytes,
                Duration::from_millis(timeout_ms),
            )
            .await
            .map_err(|error| error.to_string())?;
            write_json_line(&result)?;
            if result.outcome == ProbeOutcome::ResourceLimitEnforced && result.parent_survived {
                Ok(())
            } else {
                Err(format!("hard limit probe was inconclusive: {result:?}"))
            }
        }
        Command::OcrPilot {
            image,
            screen_type,
            layout_family,
            tessdata_path,
        } => run_ocr_pilot(&image, screen_type, layout_family, tessdata_path).await,
        Command::ChildAllocate { .. } | Command::ChildCompute { .. } => {
            Err(String::from("child command dispatch failed"))
        }
        Command::ProbeParentDeath => {
            let probe = momo_analysis::process::spawn_parent_death_probe()
                .map_err(|error| error.to_string())?;
            write_stdout_line(probe.process_id())?;
            wait_for_shutdown().await.map_err(|error| error.to_string())
        }
        Command::ChildWait {
            parent_liveness_fd,
            parent_liveness_timeout_ms,
        } => {
            momo_analysis::process::start_parent_liveness_monitor(
                parent_liveness_fd,
                Duration::from_millis(parent_liveness_timeout_ms),
            )
            .map_err(|error| error.to_string())?;
            wait_for_shutdown().await.map_err(|error| error.to_string())
        }
    }
}

async fn run_ocr_pilot(
    image_path: &std::path::Path,
    screen_type: OcrPilotScreenType,
    layout_family: Option<OcrPilotLayoutFamily>,
    tessdata_path: Option<PathBuf>,
) -> Result<(), String> {
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
    let output = NativeOcrEngine::new(tessdata_path)
        .analyze_local_image_bytes(&bytes, screen_type.into(), &hints)
        .map_err(|error| format!("OCR pilot failed: {error:?}"))?;
    write_json_line(&serde_json::json!({
        "detectedScreenType": output.detected_screen_type.wire(),
        "profileId": output.profile_id,
        "result": output.payload,
        "warnings": output.warnings,
        "timingsMilliseconds": output.timings_milliseconds,
    }))
}

async fn release_audit(require_current: bool, require_quiescent: bool) -> Result<(), String> {
    let report = momo_analysis::release::audit_completeness(require_current, require_quiescent)
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
    let report = momo_analysis::release::promote(&PromotionRequest {
        trigger,
        operation_key,
        apply,
    })
    .await
    .map_err(|error| error.to_string())?;
    write_json_line(&report)?;
    Ok(())
}

async fn shadow_endurance(request: momo_analysis::shadow::ShadowRequest) -> Result<(), String> {
    let report = momo_analysis::shadow::run(&request)
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
    info!(
        event = "analysis_configuration_accepted",
        publication_mode = ?config.publication_mode,
        "analysis worker configuration accepted"
    );
    if config.publication_mode == PublicationMode::Enabled {
        let runtime =
            WorkerRuntimeConfig::from_environment(&config).map_err(|error| error.to_string())?;
        let (shutdown_sender, shutdown_receiver) = tokio::sync::watch::channel(false);
        let worker = momo_analysis::worker::run(runtime, shutdown_receiver);
        tokio::pin!(worker);
        return tokio::select! {
            result = &mut worker => result.map_err(|error| error.to_string()),
            signal = wait_for_shutdown() => {
                signal.map_err(|error| error.to_string())?;
                if let Err(_receiver_closed) = shutdown_sender.send(true) {}
                worker.await.map_err(|error| error.to_string())
            }
        };
    }
    wait_for_shutdown()
        .await
        .map_err(|error| error.to_string())?;
    info!(event = "analysis_worker_stopped", "analysis worker stopped");
    Ok(())
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
}
