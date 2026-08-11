#[cfg(target_os = "linux")]
use std::io;
use std::{process::ExitStatus, time::Duration};

use super::{HardLimitProbeResult, ProbeOutcome, ProcessError};

/// Runs the legacy child allocation behind an address-space limit.
///
/// This is a regression probe for `RLIMIT_AS`; it is not evidence of the production physical
/// memory hard limit.
///
/// # Errors
///
/// Returns an error when the child cannot be spawned, signalled, or reaped.
#[cfg(unix)]
pub async fn run_hard_limit_probe(
    limit_bytes: u64,
    allocation_bytes: u64,
    timeout: Duration,
) -> Result<HardLimitProbeResult, ProcessError> {
    use std::os::unix::process::ExitStatusExt;

    use tokio::{process::Command, time};

    let executable = std::env::current_exe().map_err(ProcessError::CurrentExecutable)?;
    let mut command = Command::new(executable);
    command
        .arg("child-allocate")
        .arg("--allocation-bytes")
        .arg(allocation_bytes.to_string())
        .kill_on_drop(true)
        .process_group(0);
    super::configure_memory_limit(&mut command, limit_bytes);
    #[cfg(target_os = "linux")]
    super::configure_parent_death_signal(&mut command);

    let mut child = command.spawn().map_err(ProcessError::Spawn)?;
    let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;

    let status = if let Ok(result) = time::timeout(timeout, child.wait()).await {
        result.map_err(ProcessError::Wait)?
    } else {
        super::terminate_process_group(process_id, libc::SIGTERM)?;
        let status = if let Ok(result) = time::timeout(Duration::from_secs(1), child.wait()).await {
            result.map_err(ProcessError::Wait)?
        } else {
            super::terminate_process_group(process_id, libc::SIGKILL)?;
            child.wait().await.map_err(ProcessError::Wait)?
        };
        return Ok(probe_result(ProbeOutcome::TimedOut, status));
    };

    let outcome = if status.code() == Some(super::RESOURCE_LIMIT_HIT_EXIT_CODE)
        || status.signal().is_some_and(is_resource_signal)
    {
        ProbeOutcome::ResourceLimitEnforced
    } else {
        ProbeOutcome::ChildCompleted
    };
    Ok(probe_result(outcome, status))
}

/// Reports that the address-space regression probe is unavailable on non-Unix hosts.
///
/// # Errors
///
/// Always returns [`ProcessError::UnsupportedPlatform`].
#[cfg(not(unix))]
pub async fn run_hard_limit_probe(
    _limit_bytes: u64,
    _allocation_bytes: u64,
    _timeout: Duration,
) -> Result<HardLimitProbeResult, ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
}

/// Verifies the production cgroup attach barrier and hard memory limit without constraining the
/// coordinating process.
///
/// # Errors
///
/// Returns an error when configuration, attachment, signalling, or reaping fails.
#[cfg(target_os = "linux")]
pub async fn run_cgroup_hard_limit_probe(
    allocation_bytes: u64,
    timeout: Duration,
) -> Result<HardLimitProbeResult, ProcessError> {
    use std::{os::unix::process::ExitStatusExt, process::Stdio};

    use tokio::{io::AsyncWriteExt, process::Command, time};

    if allocation_bytes == 0 || timeout.is_zero() {
        return Err(ProcessError::BootstrapConfiguration);
    }
    if !super::worker_identity_supported() {
        return Err(ProcessError::InvalidWorkerIdentity);
    }
    let child_limit = super::bootstrap_config::child_memory_limit()?;
    let cgroup = crate::cgroup::ChildCgroup::from_environment(child_limit)?;
    let memory_before = cgroup.snapshot()?;
    let executable = std::env::current_exe().map_err(ProcessError::CurrentExecutable)?;
    let mut command = Command::new(executable);
    command
        .arg("child-cgroup-allocate")
        .arg("--allocation-bytes")
        .arg(allocation_bytes.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .process_group(0);
    super::configure_parent_death_signal(&mut command);
    let mut child = command.spawn().map_err(ProcessError::Spawn)?;
    let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;
    if let Err(error) = cgroup.attach(process_id) {
        terminate_probe_child(&mut child, process_id).await?;
        return Err(ProcessError::from(error));
    }
    let Some(mut start_barrier) = child.stdin.take() else {
        terminate_probe_child(&mut child, process_id).await?;
        return Err(ProcessError::StartBarrier(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "probe start barrier was unavailable",
        )));
    };
    if let Err(error) = start_barrier.write_all(&[super::CHILD_START_MARKER]).await {
        terminate_probe_child(&mut child, process_id).await?;
        return Err(ProcessError::StartBarrier(error));
    }
    if let Err(error) = start_barrier.shutdown().await {
        terminate_probe_child(&mut child, process_id).await?;
        return Err(ProcessError::StartBarrier(error));
    }
    drop(start_barrier);

    let status = if let Ok(result) = time::timeout(timeout, child.wait()).await {
        result.map_err(ProcessError::Wait)?
    } else {
        let status = terminate_probe_child(&mut child, process_id).await?;
        cgroup.ensure_empty()?;
        return Ok(probe_result(ProbeOutcome::TimedOut, status));
    };
    let memory_after = cgroup.snapshot()?;
    cgroup.ensure_empty()?;
    let outcome = if status.signal() == Some(libc::SIGKILL)
        && memory_after.oom_kill_count > memory_before.oom_kill_count
    {
        ProbeOutcome::ResourceLimitEnforced
    } else {
        ProbeOutcome::ChildCompleted
    };
    Ok(probe_result(outcome, status))
}

/// Reports that the cgroup hard-limit probe is available only on Linux.
///
/// # Errors
///
/// Always returns [`ProcessError::UnsupportedPlatform`].
#[cfg(not(target_os = "linux"))]
pub async fn run_cgroup_hard_limit_probe(
    _allocation_bytes: u64,
    _timeout: Duration,
) -> Result<HardLimitProbeResult, ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
}

#[cfg(target_os = "linux")]
async fn terminate_probe_child(
    child: &mut tokio::process::Child,
    process_id: u32,
) -> Result<ExitStatus, ProcessError> {
    use tokio::time;

    if let Some(status) = child.try_wait().map_err(ProcessError::Wait)? {
        return Ok(status);
    }
    super::terminate_process_group(process_id, libc::SIGTERM)?;
    if let Ok(result) = time::timeout(Duration::from_secs(1), child.wait()).await {
        return result.map_err(ProcessError::Wait);
    }
    super::terminate_process_group(process_id, libc::SIGKILL)?;
    child.wait().await.map_err(ProcessError::Wait)
}

#[cfg(unix)]
fn probe_result(outcome: ProbeOutcome, status: ExitStatus) -> HardLimitProbeResult {
    use std::os::unix::process::ExitStatusExt;

    HardLimitProbeResult {
        outcome,
        parent_survived: true,
        child_exit_code: status.code(),
        child_signal: status.signal(),
    }
}

#[cfg(unix)]
const fn is_resource_signal(signal: i32) -> bool {
    matches!(
        signal,
        libc::SIGABRT | libc::SIGKILL | libc::SIGSEGV | libc::SIGBUS
    )
}
