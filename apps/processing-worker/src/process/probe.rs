#[cfg(target_os = "linux")]
use std::io;
#[cfg(target_os = "linux")]
use std::process::ExitStatus;
use std::time::Duration;

#[cfg(target_os = "linux")]
use super::ProbeOutcome;
use super::{HardLimitProbeResult, ProcessError};

/// Verifies the production cgroup attach barrier and hard memory limit without constraining the
/// coordinating process.
///
/// # Errors
///
/// Returns an error when configuration, attachment, signalling, or reaping fails.
#[cfg(target_os = "linux")]
pub(crate) async fn run_cgroup_hard_limit_probe(
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
    let limit_hit_count_delta = memory_after
        .limit_hit_count
        .saturating_sub(memory_before.limit_hit_count);
    let oom_kill_count_delta = memory_after
        .oom_kill_count
        .saturating_sub(memory_before.oom_kill_count);
    let outcome = if cgroup_limit_was_enforced(
        status.signal(),
        limit_hit_count_delta,
        oom_kill_count_delta,
    ) {
        ProbeOutcome::ResourceLimitEnforced
    } else {
        ProbeOutcome::ChildCompleted
    };
    Ok(cgroup_probe_result(
        outcome,
        status,
        child_limit,
        memory_after.peak_bytes,
        limit_hit_count_delta,
        oom_kill_count_delta,
    ))
}

/// Reports that the cgroup hard-limit probe is available only on Linux.
///
/// # Errors
///
/// Always returns [`ProcessError::UnsupportedPlatform`].
#[cfg(not(target_os = "linux"))]
pub(crate) async fn run_cgroup_hard_limit_probe(
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

#[cfg(target_os = "linux")]
fn probe_result(outcome: ProbeOutcome, status: ExitStatus) -> HardLimitProbeResult {
    use std::os::unix::process::ExitStatusExt;

    HardLimitProbeResult {
        outcome,
        parent_survived: true,
        child_exit_code: status.code(),
        child_signal: status.signal(),
        cgroup_limit_bytes: None,
        cgroup_peak_bytes: None,
        cgroup_limit_hit_count_delta: None,
        cgroup_oom_kill_count_delta: None,
    }
}

#[cfg(target_os = "linux")]
fn cgroup_probe_result(
    outcome: ProbeOutcome,
    status: ExitStatus,
    limit_bytes: u64,
    peak_bytes: u64,
    limit_hit_count_delta: u64,
    oom_kill_count_delta: u64,
) -> HardLimitProbeResult {
    let mut result = probe_result(outcome, status);
    result.cgroup_limit_bytes = Some(limit_bytes);
    result.cgroup_peak_bytes = Some(peak_bytes);
    result.cgroup_limit_hit_count_delta = Some(limit_hit_count_delta);
    result.cgroup_oom_kill_count_delta = Some(oom_kill_count_delta);
    result
}

#[cfg(all(unix, any(target_os = "linux", test)))]
fn cgroup_limit_was_enforced(
    child_signal: Option<i32>,
    limit_hit_count_delta: u64,
    oom_kill_count_delta: u64,
) -> bool {
    child_signal == Some(libc::SIGKILL) && limit_hit_count_delta > 0 && oom_kill_count_delta > 0
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::cgroup_limit_was_enforced;

    #[cfg(unix)]
    #[test]
    fn cgroup_probe_rejects_a_global_oom_without_a_limit_hit() {
        assert!(!cgroup_limit_was_enforced(Some(libc::SIGKILL), 0, 1));
        assert!(cgroup_limit_was_enforced(Some(libc::SIGKILL), 1, 1));
        assert!(!cgroup_limit_was_enforced(Some(libc::SIGTERM), 1, 1));
    }
}
