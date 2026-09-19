//! Analysis-specific child arguments, exit interpretation and lifecycle adapter.

#[cfg(unix)]
use std::io::Write;
use std::{io, path::PathBuf, process::ExitStatus, time::Duration};

use crate::cgroup::ChildCgroup;
use crate::process::{
    CHILD_DEPENDENCY_FAILED_EXIT_CODE, CHILD_PARENT_LIVENESS_LOST_EXIT_CODE,
    CHILD_START_BARRIER_FAILED_EXIT_CODE, ProcessError, RESOURCE_LIMIT_HIT_EXIT_CODE,
    process_peak_resident_bytes,
};
#[cfg(target_os = "linux")]
use crate::process::{
    CHILD_START_MARKER, configure_inherited_liveness, configure_parent_death_signal,
    preserve_dynamic_runtime_environment,
};
#[cfg(unix)]
use crate::process::{
    child_stop_deadlines, stop_and_reap_child, stop_remaining_process_group,
    terminate_process_group,
};

#[cfg(test)]
#[cfg(unix)]
mod liveness_tests;

pub(super) const CHILD_SUPERSEDED_EXIT_CODE: i32 = 78;
pub(super) const CHILD_INPUT_INVALID_EXIT_CODE: i32 = 79;
pub(super) const CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE: i32 = 80;
pub(super) const CHILD_CALCULATION_FAILED_EXIT_CODE: i32 = 81;

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct AnalysisChildProcessSpec {
    pub(crate) identity: momo_analysis_core::child::AnalysisAttemptIdentity,
    pub(crate) read_database_url: String,
    pub(crate) output_directory: PathBuf,
    pub(crate) maximum_chunk_bytes: u64,
    pub(crate) maximum_chunk_count: u64,
    pub(crate) maximum_total_bytes: u64,
    pub(crate) maximum_file_count: u64,
    pub(crate) parent_liveness_timeout: Duration,
}

impl std::fmt::Debug for AnalysisChildProcessSpec {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AnalysisChildProcessSpec([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AnalysisChildOutcome {
    Succeeded,
    Superseded,
    InputInvalid,
    ArtifactTooLarge,
    ResourceExhausted,
    DependencyFailed,
    ParentLivenessLost,
    CalculationFailed,
}

impl AnalysisChildOutcome {
    #[must_use]
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Superseded => "superseded",
            Self::InputInvalid => "input_invalid",
            Self::ArtifactTooLarge => "artifact_too_large",
            Self::ResourceExhausted => "resource_exhausted",
            Self::DependencyFailed => "dependency_failed",
            Self::ParentLivenessLost => "parent_liveness_lost",
            Self::CalculationFailed => "calculation_failed",
        }
    }
}

pub(crate) struct ManagedAnalysisChild {
    child: tokio::process::Child,
    process_id: u32,
    peak_resident_bytes: Option<u64>,
    cgroup: ChildCgroup,
    oom_kill_count_before: u64,
    #[cfg(unix)]
    parent_liveness: std::os::unix::net::UnixStream,
}

impl ManagedAnalysisChild {
    /// Starts the calculation subprocess, attaches it to the fixed hard-limit cgroup, verifies
    /// membership, and only then releases its computation barrier.
    ///
    /// # Errors
    ///
    /// Returns an error when the current executable cannot be resolved or the child cannot start.
    #[cfg(target_os = "linux")]
    pub(crate) async fn spawn(
        spec: &AnalysisChildProcessSpec,
        cgroup: &ChildCgroup,
        stop_grace: Duration,
    ) -> Result<Self, ProcessError> {
        use std::os::fd::AsRawFd;
        use std::os::unix::net::UnixStream;
        use std::process::Stdio;

        use tokio::{io::AsyncWriteExt, process::Command};

        let executable = std::env::current_exe().map_err(ProcessError::CurrentExecutable)?;
        child_stop_deadlines(stop_grace)?;
        let liveness_timeout_millis = u64::try_from(spec.parent_liveness_timeout.as_millis())?;
        if liveness_timeout_millis == 0 {
            return Err(ProcessError::LivenessTimeoutBound);
        }
        let (parent_liveness, child_liveness) =
            UnixStream::pair().map_err(ProcessError::Liveness)?;
        parent_liveness
            .set_nonblocking(true)
            .map_err(ProcessError::Liveness)?;
        let child_liveness_fd = child_liveness.as_raw_fd();
        let memory_before = cgroup.snapshot()?;
        let mut command = Command::new(executable);
        command
            .arg("child-compute")
            .arg("--game-title-id")
            .arg(&spec.identity.game_title_id)
            .arg("--input-revision")
            .arg(spec.identity.input_revision.to_string())
            .arg("--artifact-id")
            .arg(&spec.identity.artifact_id)
            .arg("--output-directory")
            .arg(&spec.output_directory)
            .arg("--maximum-chunk-bytes")
            .arg(spec.maximum_chunk_bytes.to_string())
            .arg("--maximum-chunk-count")
            .arg(spec.maximum_chunk_count.to_string())
            .arg("--maximum-total-bytes")
            .arg(spec.maximum_total_bytes.to_string())
            .arg("--maximum-file-count")
            .arg(spec.maximum_file_count.to_string())
            .arg("--parent-liveness-fd")
            .arg(child_liveness_fd.to_string())
            .arg("--parent-liveness-timeout-ms")
            .arg(liveness_timeout_millis.to_string())
            .env_clear()
            .env("MOMO_ANALYSIS_READ_DATABASE_URL", &spec.read_database_url)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .process_group(0);
        preserve_dynamic_runtime_environment(&mut command);
        configure_parent_death_signal(&mut command);
        configure_inherited_liveness(&mut command, child_liveness_fd);
        let child = command.spawn().map_err(ProcessError::Spawn)?;
        drop(child_liveness);
        let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;
        let mut managed = Self {
            child,
            process_id,
            peak_resident_bytes: None,
            cgroup: cgroup.clone(),
            oom_kill_count_before: memory_before.oom_kill_count,
            parent_liveness,
        };
        if let Err(error) = managed.cgroup.attach(process_id) {
            let setup_error = ProcessError::from(error);
            return Err(managed.resolve_setup_failure(setup_error, stop_grace).await);
        }
        let Some(mut start_barrier) = managed.child.stdin.take() else {
            let setup_error = ProcessError::StartBarrier(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "child start barrier was unavailable",
            ));
            return Err(managed.resolve_setup_failure(setup_error, stop_grace).await);
        };
        if let Err(error) = start_barrier.write_all(&[CHILD_START_MARKER]).await {
            let setup_error = ProcessError::StartBarrier(error);
            return Err(managed.resolve_setup_failure(setup_error, stop_grace).await);
        }
        if let Err(error) = start_barrier.shutdown().await {
            let setup_error = ProcessError::StartBarrier(error);
            return Err(managed.resolve_setup_failure(setup_error, stop_grace).await);
        }
        drop(start_barrier);
        Ok(managed)
    }

    /// Reports that managed calculation children require the production Linux isolation contract.
    ///
    /// # Errors
    ///
    /// Always returns [`ProcessError::UnsupportedPlatform`].
    #[cfg(not(target_os = "linux"))]
    #[expect(
        clippy::unused_async,
        reason = "the cross-platform API remains awaitable while non-Linux runtimes fail closed"
    )]
    pub(crate) async fn spawn(
        _spec: &AnalysisChildProcessSpec,
        _cgroup: &ChildCgroup,
        _stop_grace: Duration,
    ) -> Result<Self, ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }

    #[must_use]
    pub(crate) const fn peak_resident_bytes(&self) -> Option<u64> {
        self.peak_resident_bytes
    }

    #[cfg(target_os = "linux")]
    async fn resolve_setup_failure(
        &mut self,
        setup_error: ProcessError,
        stop_grace: Duration,
    ) -> ProcessError {
        let cleanup_result = self.terminate(stop_grace).await.map(drop);
        resolve_spawn_setup_failure(setup_error, cleanup_result)
    }

    /// Refreshes the child's liveness deadline, or returns its verified completed outcome.
    ///
    /// The child can close its socket before its exit becomes waitable. On channel failure, allow
    /// it to finish within the caller's bounded exit grace instead of signalling a normal exit.
    ///
    /// # Errors
    ///
    /// Returns an error if the channel fails and the child remains alive past the grace period,
    /// or if waiting and verifying the exited child's cgroup fails. The caller still owns cleanup.
    #[cfg(unix)]
    pub(crate) async fn refresh_liveness(
        &mut self,
        exit_grace: Duration,
    ) -> Result<Option<AnalysisChildOutcome>, ProcessError> {
        let channel_error = match self.parent_liveness.write(&[1]) {
            Ok(1) => return Ok(None),
            Ok(_) => io::Error::new(
                io::ErrorKind::WriteZero,
                "child liveness channel accepted no data",
            ),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(None),
            Err(error) => error,
        };
        let deadline = child_stop_deadlines(exit_grace)?.overall;
        match tokio::time::timeout_at(deadline, self.child.wait()).await {
            Ok(Ok(status)) => self.completed_outcome(status).map(Some),
            Ok(Err(error)) => Err(ProcessError::Wait(error)),
            Err(_elapsed) => Err(ProcessError::Liveness(channel_error)),
        }
    }

    /// Reports that child liveness channels require Unix file descriptors.
    #[cfg(not(unix))]
    pub(crate) async fn refresh_liveness(
        &mut self,
        _exit_grace: Duration,
    ) -> Result<Option<AnalysisChildOutcome>, ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }

    /// Samples the child resident set where the host exposes a process status file.
    pub(crate) async fn sample_resident_bytes(&mut self) {
        if let Some(bytes) = process_peak_resident_bytes(self.process_id).await {
            self.peak_resident_bytes = Some(
                self.peak_resident_bytes
                    .map_or(bytes, |current| current.max(bytes)),
            );
        }
    }

    /// Checks whether the child has exited without blocking.
    ///
    /// # Errors
    ///
    /// Returns an error when the operating system cannot report child state.
    pub(crate) fn try_wait(&mut self) -> Result<Option<AnalysisChildOutcome>, ProcessError> {
        let Some(status) = self.child.try_wait().map_err(ProcessError::Wait)? else {
            return Ok(None);
        };
        self.completed_outcome(status).map(Some)
    }

    fn completed_outcome(&self, status: ExitStatus) -> Result<AnalysisChildOutcome, ProcessError> {
        let memory_after = self.cgroup.snapshot()?;
        self.cgroup.ensure_empty()?;
        Ok(classify_analysis_status(
            status,
            memory_after.oom_kill_count > self.oom_kill_count_before,
        ))
    }

    /// Stops the child process group, gives it a bounded grace period, and always reaps it.
    ///
    /// # Errors
    ///
    /// Returns an error when signalling or reaping the child fails.
    #[cfg(unix)]
    pub(crate) async fn terminate(&mut self, grace: Duration) -> Result<ExitStatus, ProcessError> {
        let deadlines = child_stop_deadlines(grace)?;
        let status = stop_and_reap_child(&mut self.child, self.process_id, deadlines).await;
        stop_remaining_process_group(self.process_id, &self.cgroup, deadlines.overall).await?;
        status
    }

    /// Reports that managed process-group termination requires Unix.
    ///
    /// # Errors
    ///
    /// Always returns [`ProcessError::UnsupportedPlatform`].
    #[cfg(not(unix))]
    pub(crate) async fn terminate(&mut self, _grace: Duration) -> Result<ExitStatus, ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }
}

#[cfg(any(target_os = "linux", test))]
fn resolve_spawn_setup_failure(
    setup_error: ProcessError,
    cleanup_result: Result<(), ProcessError>,
) -> ProcessError {
    let setup_kind = setup_error.kind();
    match cleanup_result {
        Ok(()) => setup_error,
        Err(cleanup_error) => ProcessError::SpawnCleanupUnverified {
            setup_kind,
            cleanup_kind: cleanup_error.kind(),
        },
    }
}

#[cfg(unix)]
impl Drop for ManagedAnalysisChild {
    fn drop(&mut self) {
        let leader_reaped = matches!(self.child.try_wait(), Ok(Some(_status)));
        let cleanup_verified = self.cgroup.ensure_empty().is_ok();
        if drop_requires_group_kill(leader_reaped, cleanup_verified) {
            drop(terminate_process_group(self.process_id, libc::SIGKILL));
            // Drop cannot await the verified cleanup loop, but the same cgroup-wide hard-stop pass
            // prevents a setsid descendant from escaping the synchronous fail-closed fallback.
            drop(self.cgroup.hard_kill());
        }
    }
}

#[cfg(unix)]
const fn drop_requires_group_kill(leader_reaped: bool, cleanup_verified: bool) -> bool {
    !leader_reaped || !cleanup_verified
}

/// Returns whether this host implements the complete production child-isolation contract.
#[must_use]
pub(crate) const fn managed_analysis_runtime_supported() -> bool {
    cfg!(target_os = "linux")
}

fn classify_analysis_status(
    status: ExitStatus,
    cgroup_oom_kill_observed: bool,
) -> AnalysisChildOutcome {
    if cgroup_oom_kill_observed {
        return AnalysisChildOutcome::ResourceExhausted;
    }
    match status.code() {
        Some(0) => AnalysisChildOutcome::Succeeded,
        Some(CHILD_SUPERSEDED_EXIT_CODE) => AnalysisChildOutcome::Superseded,
        Some(CHILD_INPUT_INVALID_EXIT_CODE) => AnalysisChildOutcome::InputInvalid,
        Some(CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE) => AnalysisChildOutcome::ArtifactTooLarge,
        Some(RESOURCE_LIMIT_HIT_EXIT_CODE) => AnalysisChildOutcome::ResourceExhausted,
        Some(CHILD_DEPENDENCY_FAILED_EXIT_CODE | CHILD_START_BARRIER_FAILED_EXIT_CODE) => {
            AnalysisChildOutcome::DependencyFailed
        }
        Some(CHILD_PARENT_LIVENESS_LOST_EXIT_CODE) => AnalysisChildOutcome::ParentLivenessLost,
        _ => AnalysisChildOutcome::CalculationFailed,
    }
}

#[cfg(test)]
mod child_cleanup_tests {
    use std::io;

    #[cfg(unix)]
    use std::time::Duration;

    #[cfg(unix)]
    use super::child_stop_deadlines;
    #[cfg(unix)]
    use super::drop_requires_group_kill;
    use super::{ProcessError, resolve_spawn_setup_failure};

    #[cfg(unix)]
    #[test]
    fn drop_kills_when_leader_or_cgroup_cleanup_is_unverified() {
        assert!(!drop_requires_group_kill(true, true));
        assert!(drop_requires_group_kill(false, true));
        assert!(drop_requires_group_kill(true, false));
    }

    #[test]
    fn verified_spawn_cleanup_preserves_the_original_setup_failure() {
        let resolved = resolve_spawn_setup_failure(
            ProcessError::StartBarrier(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "fixture setup failure",
            )),
            Ok(()),
        );

        assert!(matches!(resolved, ProcessError::StartBarrier(_)));
        assert!(!resolved.spawn_cleanup_unverified());
    }

    #[test]
    fn failed_spawn_cleanup_reports_both_failure_boundaries() {
        let resolved = resolve_spawn_setup_failure(
            ProcessError::StartBarrier(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "fixture setup failure",
            )),
            Err(ProcessError::StopTimeout),
        );

        assert!(resolved.spawn_cleanup_unverified());
        assert!(matches!(
            resolved,
            ProcessError::SpawnCleanupUnverified {
                setup_kind: "child_start_barrier",
                cleanup_kind: "child_stop_timeout",
            }
        ));
    }

    #[test]
    fn only_post_spawn_uncertainty_is_classified_as_unverified_cleanup() {
        let missing_process_id = ProcessError::MissingProcessId;
        let pure_spawn_failure =
            ProcessError::Spawn(io::Error::other("fixture process was never created"));

        assert!(missing_process_id.spawn_cleanup_unverified());
        assert!(!pure_spawn_failure.spawn_cleanup_unverified());
    }

    #[cfg(unix)]
    #[test]
    fn stop_deadline_reserves_budget_for_reap_and_cgroup_cleanup() {
        let result = child_stop_deadlines(Duration::from_secs(8));
        assert!(result.is_ok());
        let Some(deadlines) = result.ok() else {
            return;
        };

        assert_eq!(deadlines.reap - deadlines.soft, Duration::from_secs(2));
        assert_eq!(deadlines.overall - deadlines.reap, Duration::from_secs(2));
        assert!(matches!(
            child_stop_deadlines(Duration::ZERO),
            Err(ProcessError::StopTimeoutBound)
        ));
    }
}
