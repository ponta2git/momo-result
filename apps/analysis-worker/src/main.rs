use std::{
    fmt::Display,
    io::{self, Write},
    path::PathBuf,
    process::ExitCode,
    time::Duration,
};

use clap::{Parser, Subcommand};
use momo_analysis::{
    config::{PublicationMode, WorkerConfig, WorkerRuntimeConfig},
    process::{ProbeOutcome, allocate_and_touch, run_hard_limit_probe},
    release::{PromotionRequest, PromotionTrigger},
};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

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
