use std::{
    ffi::OsString,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::ExitStatus,
    time::Duration,
};

use serde::Serialize;
use thiserror::Error;

use crate::cgroup::{CgroupError, ChildCgroup};

mod allocation;
#[cfg(target_os = "linux")]
mod bootstrap_config;
mod probe;

pub(crate) use allocation::allocate_and_touch;
pub(crate) use probe::run_cgroup_hard_limit_probe;

pub(crate) const RESOURCE_LIMIT_HIT_EXIT_CODE: i32 = 73;
pub(crate) const CHILD_SUPERSEDED_EXIT_CODE: i32 = 78;
pub(crate) const CHILD_INPUT_INVALID_EXIT_CODE: i32 = 79;
pub(crate) const CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE: i32 = 80;
pub(crate) const CHILD_CALCULATION_FAILED_EXIT_CODE: i32 = 81;
pub(crate) const CHILD_DEPENDENCY_FAILED_EXIT_CODE: i32 = 82;
pub(crate) const CHILD_PARENT_LIVENESS_LOST_EXIT_CODE: i32 = 83;
pub(crate) const CHILD_START_BARRIER_FAILED_EXIT_CODE: i32 = 84;

pub(crate) const CHILD_START_MARKER: u8 = 0x4d;
#[cfg(target_os = "linux")]
const WORKER_UID: libc::uid_t = 10_001;
#[cfg(target_os = "linux")]
const WORKER_GID: libc::gid_t = 10_001;

#[derive(Clone, Debug, Eq, PartialEq)]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProbeOutcome {
    ResourceLimitEnforced,
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "the production cgroup probe runs only on Linux")
    )]
    ChildCompleted,
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "the production cgroup probe runs only on Linux")
    )]
    TimedOut,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HardLimitProbeResult {
    pub(crate) outcome: ProbeOutcome,
    pub(crate) parent_survived: bool,
    pub(crate) child_exit_code: Option<i32>,
    pub(crate) child_signal: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cgroup_limit_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cgroup_peak_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cgroup_limit_hit_count_delta: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cgroup_oom_kill_count_delta: Option<u64>,
}

pub(crate) struct ParentDeathProbe {
    process_id: u32,
    _child: tokio::process::Child,
    #[cfg(unix)]
    _parent_liveness: std::os::unix::net::UnixStream,
}

impl ParentDeathProbe {
    #[must_use]
    pub(crate) const fn process_id(&self) -> u32 {
        self.process_id
    }
}

#[derive(Debug, Error)]
pub(crate) enum ProcessError {
    #[error("child memory limit is not supported on this platform")]
    UnsupportedPlatform,
    #[error("failed to resolve the current executable: {0}")]
    CurrentExecutable(io::Error),
    #[error("failed to spawn child process: {0}")]
    Spawn(io::Error),
    #[error("failed while waiting for child process: {0}")]
    Wait(io::Error),
    #[error("failed to signal child process group: {0}")]
    Signal(io::Error),
    #[error("child process stop deadline elapsed")]
    StopTimeout,
    #[error("child process stop duration exceeds a supported bound")]
    StopTimeoutBound,
    #[error("child process did not expose a process id")]
    MissingProcessId,
    #[error("failed to establish or refresh child liveness: {0}")]
    Liveness(io::Error),
    #[error("failed to release the isolated child start barrier: {0}")]
    StartBarrier(io::Error),
    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(dead_code, reason = "spawn setup cleanup runs only on Linux")
    )]
    #[error("spawned child cleanup was not verified after {setup_kind} ({cleanup_kind})")]
    SpawnCleanupUnverified {
        setup_kind: &'static str,
        cleanup_kind: &'static str,
    },
    #[error("managed child cgroup failed: {kind}")]
    Cgroup { kind: &'static str },
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "the Linux child launcher validates this bound")
    )]
    #[error("child liveness timeout exceeds a supported bound")]
    LivenessTimeoutBound,
    #[error("child liveness timeout conversion exceeds a supported bound")]
    LivenessTimeoutConversion(#[from] std::num::TryFromIntError),
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "bootstrap execution is Linux-only")
    )]
    #[error("worker bootstrap command is not permitted")]
    BootstrapCommand,
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "bootstrap execution is Linux-only")
    )]
    #[error("worker bootstrap configuration is missing or invalid")]
    BootstrapConfiguration,
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "bootstrap execution is Linux-only")
    )]
    #[error("worker bootstrap identity transition failed: {0}")]
    BootstrapIdentity(io::Error),
    #[cfg_attr(
        not(target_os = "linux"),
        expect(dead_code, reason = "bootstrap execution is Linux-only")
    )]
    #[error("worker bootstrap could not execute the unprivileged command: {0}")]
    BootstrapExec(io::Error),
    #[error("worker process does not have the fixed unprivileged identity")]
    InvalidWorkerIdentity,
}

impl ProcessError {
    #[must_use]
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::CurrentExecutable(_) => "current_executable",
            Self::Spawn(_) => "child_spawn",
            Self::Wait(_) => "child_wait",
            Self::Signal(_) => "child_signal",
            Self::StopTimeout => "child_stop_timeout",
            Self::StopTimeoutBound => "child_stop_timeout_bound",
            Self::MissingProcessId => "child_process_id_missing",
            Self::Liveness(_) => "child_liveness",
            Self::StartBarrier(_) => "child_start_barrier",
            Self::SpawnCleanupUnverified { .. } => "child_spawn_cleanup_unverified",
            Self::Cgroup { kind } => kind,
            Self::LivenessTimeoutBound => "child_liveness_timeout_bound",
            Self::LivenessTimeoutConversion(_) => "child_liveness_timeout_conversion",
            Self::BootstrapCommand => "bootstrap_command",
            Self::BootstrapConfiguration => "bootstrap_configuration",
            Self::BootstrapIdentity(_) => "bootstrap_identity",
            Self::BootstrapExec(_) => "bootstrap_exec",
            Self::InvalidWorkerIdentity => "worker_identity",
        }
    }

    /// Returns whether `spawn` created a child whose cleanup could not be verified.
    ///
    /// Other spawn errors either precede process creation or preserve their setup failure only
    /// after bounded termination, reap, and cgroup-empty verification succeeded.
    #[must_use]
    pub(crate) const fn spawn_cleanup_unverified(&self) -> bool {
        matches!(
            self,
            Self::MissingProcessId | Self::SpawnCleanupUnverified { .. }
        )
    }
}

impl From<CgroupError> for ProcessError {
    fn from(error: CgroupError) -> Self {
        Self::Cgroup { kind: error.kind() }
    }
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

    /// Refreshes the child's monotonic liveness deadline without blocking the worker runtime.
    ///
    /// # Errors
    ///
    /// Returns an error if the liveness channel has failed for a child that is still expected to
    /// be running.
    #[cfg(unix)]
    pub(crate) fn refresh_liveness(&mut self) -> Result<(), ProcessError> {
        match self.parent_liveness.write(&[1]) {
            Ok(1) => Ok(()),
            Ok(_) => Err(ProcessError::Liveness(io::Error::new(
                io::ErrorKind::WriteZero,
                "child liveness channel accepted no data",
            ))),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(()),
            Err(error) => Err(ProcessError::Liveness(error)),
        }
    }

    /// Reports that child liveness channels require Unix file descriptors.
    #[cfg(not(unix))]
    pub(crate) fn refresh_liveness(&mut self) -> Result<(), ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }

    /// Samples the child resident set where the host exposes a process status file.
    pub(crate) async fn sample_resident_bytes(&mut self) {
        if let Some(bytes) = process_status_bytes(self.process_id, "VmHWM:").await {
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
        let memory_after = self.cgroup.snapshot()?;
        self.cgroup.ensure_empty()?;
        Ok(Some(classify_analysis_status(
            status,
            memory_after.oom_kill_count > self.oom_kill_count_before,
        )))
    }

    /// Stops the child process group, gives it a bounded grace period, and always reaps it.
    ///
    /// # Errors
    ///
    /// Returns an error when signalling or reaping the child fails.
    #[cfg(unix)]
    pub(crate) async fn terminate(&mut self, grace: Duration) -> Result<ExitStatus, ProcessError> {
        use tokio::time;

        let deadlines = child_stop_deadlines(grace)?;
        let status = match self.child.try_wait() {
            Ok(Some(status)) => Ok(status),
            Ok(None) => match terminate_process_group(self.process_id, libc::SIGTERM) {
                Ok(()) => match time::timeout_at(deadlines.soft, self.child.wait()).await {
                    Ok(Ok(status)) => Ok(status),
                    Ok(Err(_)) | Err(_) => {
                        force_kill_and_reap_analysis_child(
                            &mut self.child,
                            self.process_id,
                            deadlines.reap,
                        )
                        .await
                    }
                },
                Err(_error) => {
                    force_kill_and_reap_analysis_child(
                        &mut self.child,
                        self.process_id,
                        deadlines.reap,
                    )
                    .await
                }
            },
            Err(_error) => {
                force_kill_and_reap_analysis_child(&mut self.child, self.process_id, deadlines.reap)
                    .await
            }
        };
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

/// Prepares the fixed child cgroup as root, permanently drops to the worker identity, and
/// re-executes one allowlisted command without a shell.
///
/// # Errors
///
/// Returns an error when the command, cgroup, identity transition, or exec boundary is invalid.
#[cfg(target_os = "linux")]
pub(crate) fn bootstrap_and_exec(arguments: &[OsString]) -> Result<(), ProcessError> {
    use std::{os::unix::process::CommandExt, process::Command};

    if !bootstrap_config::command_allowed(arguments) {
        return Err(ProcessError::BootstrapCommand);
    }
    // SAFETY: geteuid has no preconditions and does not dereference pointers.
    if unsafe { libc::geteuid() } != 0 {
        return Err(ProcessError::BootstrapIdentity(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "bootstrap requires effective root",
        )));
    }
    let executable = std::env::current_exe().map_err(ProcessError::CurrentExecutable)?;
    let mut command = Command::new(executable);
    command.args(arguments);
    if bootstrap_config::requires_child_cgroup(arguments) {
        let child_limit = bootstrap_config::child_memory_limit()?;
        let prepared =
            crate::cgroup::prepare_production_child_cgroup(child_limit, WORKER_UID, WORKER_GID)?;
        command.envs(prepared.environment());
    }
    drop_worker_privileges()?;
    let error = command.exec();
    Err(ProcessError::BootstrapExec(error))
}

/// Reports that root cgroup bootstrap is available only on Linux.
///
/// # Errors
///
/// Always returns [`ProcessError::UnsupportedPlatform`].
#[cfg(not(target_os = "linux"))]
pub(crate) const fn bootstrap_and_exec(_arguments: &[OsString]) -> Result<(), ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
}

#[cfg(target_os = "linux")]
#[must_use]
pub(crate) fn worker_identity_supported() -> bool {
    let mut real_user_id = 0;
    let mut effective_user_id = 0;
    let mut saved_user_id = 0;
    let mut real_group_id = 0;
    let mut effective_group_id = 0;
    let mut saved_group_id = 0;
    // SAFETY: all pointers reference writable uid/gid values for the duration of the calls.
    let uid_result = unsafe {
        libc::getresuid(
            &raw mut real_user_id,
            &raw mut effective_user_id,
            &raw mut saved_user_id,
        )
    };
    // SAFETY: see the preceding safety argument.
    let gid_result = unsafe {
        libc::getresgid(
            &raw mut real_group_id,
            &raw mut effective_group_id,
            &raw mut saved_group_id,
        )
    };
    // SAFETY: a zero-length getgroups call accepts a null list and returns only the count.
    let supplementary_group_count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    // SAFETY: PR_GET_NO_NEW_PRIVS has no pointer arguments and only reads process state.
    let no_new_privileges = unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) };

    uid_result == 0
        && gid_result == 0
        && [real_user_id, effective_user_id, saved_user_id] == [WORKER_UID; 3]
        && [real_group_id, effective_group_id, saved_group_id] == [WORKER_GID; 3]
        && supplementary_group_count == 0
        && no_new_privileges == 1
}

#[cfg(not(target_os = "linux"))]
#[must_use]
pub(crate) const fn worker_identity_supported() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn drop_worker_privileges() -> Result<(), ProcessError> {
    // SAFETY: setgroups receives a zero length and null pointer, which clears supplementary groups.
    if unsafe { libc::setgroups(0, std::ptr::null()) } != 0 {
        return Err(ProcessError::BootstrapIdentity(io::Error::last_os_error()));
    }
    // SAFETY: prctl with PR_SET_NO_NEW_PRIVS and argument 1 has no pointer arguments.
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(ProcessError::BootstrapIdentity(io::Error::last_os_error()));
    }
    // SAFETY: the fixed numeric IDs are valid uid/gid values and all saved IDs are replaced.
    if unsafe { libc::setresgid(WORKER_GID, WORKER_GID, WORKER_GID) } != 0 {
        return Err(ProcessError::BootstrapIdentity(io::Error::last_os_error()));
    }
    // SAFETY: the fixed numeric IDs are valid uid/gid values and all saved IDs are replaced.
    if unsafe { libc::setresuid(WORKER_UID, WORKER_UID, WORKER_UID) } != 0 {
        return Err(ProcessError::BootstrapIdentity(io::Error::last_os_error()));
    }
    if !worker_identity_supported() {
        return Err(ProcessError::InvalidWorkerIdentity);
    }
    Ok(())
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

/// Blocks a hidden compute child until its parent has completed cgroup attachment and readback.
///
/// # Errors
///
/// Returns an error if stdin closes early, carries the wrong marker, or contains trailing bytes.
pub(crate) fn wait_for_child_start_barrier() -> Result<(), ProcessError> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut marker = [0_u8; 1];
    input
        .read_exact(&mut marker)
        .map_err(ProcessError::StartBarrier)?;
    if marker != [CHILD_START_MARKER] {
        return Err(ProcessError::StartBarrier(io::Error::new(
            io::ErrorKind::InvalidData,
            "child start barrier marker was invalid",
        )));
    }
    let mut trailing = [0_u8; 1];
    if input
        .read(&mut trailing)
        .map_err(ProcessError::StartBarrier)?
        != 0
    {
        return Err(ProcessError::StartBarrier(io::Error::new(
            io::ErrorKind::InvalidData,
            "child start barrier contained trailing input",
        )));
    }
    drop(input);
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn preserve_dynamic_runtime_environment(command: &mut tokio::process::Command) {
    if let Some(value) = std::env::var_os("LD_LIBRARY_PATH") {
        command.env("LD_LIBRARY_PATH", value);
    }
}

#[cfg(target_os = "linux")]
async fn process_status_bytes(process_id: u32, field: &str) -> Option<u64> {
    let path = Path::new("/proc")
        .join(process_id.to_string())
        .join("status");
    let status = tokio::fs::read_to_string(path).await.ok()?;
    status.lines().find_map(|line| {
        let kibibytes = line.strip_prefix(field)?.trim();
        let number = kibibytes.strip_suffix("kB")?.trim().parse::<u64>().ok()?;
        number.checked_mul(1024)
    })
}

#[cfg(not(target_os = "linux"))]
#[expect(
    clippy::unused_async,
    reason = "the cross-platform caller awaits this function and Linux performs asynchronous I/O"
)]
async fn process_status_bytes(_process_id: u32, _field: &str) -> Option<u64> {
    None
}

#[must_use]
pub(crate) async fn current_process_peak_resident_bytes() -> Option<u64> {
    process_status_bytes(std::process::id(), "VmHWM:").await
}

#[must_use]
pub(crate) async fn current_process_resident_bytes() -> Option<u64> {
    process_status_bytes(std::process::id(), "VmRSS:").await
}

/// Returns the currently available bytes on the filesystem containing `path`.
///
/// # Errors
///
/// Returns an error when the platform cannot inspect capacity, the path is invalid, or the
/// filesystem reports a value outside the supported `u64` range.
#[cfg(unix)]
pub(crate) fn available_filesystem_bytes(path: &Path) -> Result<u64, io::Error> {
    use std::os::unix::ffi::OsStrExt;

    let path = std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: path is a valid NUL-terminated string and stats points to writable storage.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: statvfs initialized stats after returning success.
    let stats = unsafe { stats.assume_init() };
    let available_bytes = u128::from(stats.f_bavail)
        .checked_mul(u128::from(stats.f_frsize))
        .ok_or_else(|| io::Error::other("temporary capacity arithmetic overflow"))?;
    u64::try_from(available_bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(not(unix))]
pub(crate) fn available_filesystem_bytes(_path: &Path) -> Result<u64, io::Error> {
    Err(io::Error::other(
        "temporary capacity inspection is unsupported",
    ))
}

#[cfg(unix)]
/// Spawns a child that receives a death signal if this parent disappears.
///
/// # Errors
///
/// Returns an error when the executable cannot be resolved or the child cannot be spawned.
pub(crate) fn spawn_parent_death_probe() -> Result<ParentDeathProbe, ProcessError> {
    use std::os::fd::AsRawFd;
    use std::os::unix::net::UnixStream;

    use tokio::process::Command;

    let executable = std::env::current_exe().map_err(ProcessError::CurrentExecutable)?;
    let (parent_liveness, child_liveness) = UnixStream::pair().map_err(ProcessError::Liveness)?;
    let child_liveness_fd = child_liveness.as_raw_fd();
    let mut command = Command::new(executable);
    command
        .arg("child-wait")
        .arg("--parent-liveness-fd")
        .arg(child_liveness_fd.to_string())
        .arg("--parent-liveness-timeout-ms")
        .arg("30000")
        .kill_on_drop(false)
        .process_group(0);
    configure_inherited_liveness(&mut command, child_liveness_fd);
    let child = command.spawn().map_err(ProcessError::Spawn)?;
    drop(child_liveness);
    let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;
    Ok(ParentDeathProbe {
        process_id,
        _child: child,
        _parent_liveness: parent_liveness,
    })
}

#[cfg(not(unix))]
/// Reports that the parent-death probe is unavailable on non-Unix hosts.
///
/// # Errors
///
/// Always returns [`ProcessError::UnsupportedPlatform`].
pub(crate) fn spawn_parent_death_probe() -> Result<ParentDeathProbe, ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
}

#[cfg(target_os = "linux")]
pub(crate) fn configure_parent_death_signal(command: &mut tokio::process::Command) {
    // SAFETY: getpid has no preconditions and does not dereference pointers.
    let expected_parent_pid = unsafe { libc::getpid() };
    // SAFETY: the closure invokes only the async-signal-safe prctl/getppid wrappers before exec.
    unsafe {
        command.pre_exec(move || configure_parent_death_signal_before_exec(expected_parent_pid));
    }
}

#[cfg(unix)]
pub(crate) fn configure_inherited_liveness(command: &mut tokio::process::Command, descriptor: i32) {
    // SAFETY: fcntl(F_GETFD/F_SETFD) is async-signal-safe, uses an already-open descriptor, and
    // performs no allocation or lock acquisition between fork and exec.
    unsafe {
        command.pre_exec(move || {
            let flags = descriptor_flags(descriptor)?;
            set_descriptor_flags(descriptor, flags & !libc::FD_CLOEXEC)?;
            Ok(())
        });
    }
}

#[cfg(unix)]
fn descriptor_flags(descriptor: i32) -> io::Result<i32> {
    // SAFETY: F_GETFD only reads flags from an already-open descriptor.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    if flags < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(flags)
    }
}

#[cfg(unix)]
fn set_descriptor_flags(descriptor: i32, flags: i32) -> io::Result<()> {
    // SAFETY: F_SETFD only updates flags on an already-open descriptor.
    if unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Starts the child-side monitor for EOF and missed parent liveness updates.
///
/// The monitor deliberately uses a dedicated blocking thread: calculation is synchronous and may
/// occupy the child's single-thread Tokio runtime for a long period.
///
/// # Errors
///
/// Returns an error when the inherited descriptor is invalid or the monitor cannot be started.
#[cfg(unix)]
pub(crate) fn start_parent_liveness_monitor(
    descriptor: i32,
    timeout: Duration,
) -> Result<(), ProcessError> {
    use std::os::fd::FromRawFd;
    use std::os::unix::net::UnixStream;

    if descriptor <= libc::STDERR_FILENO || timeout.is_zero() {
        return Err(ProcessError::Liveness(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid inherited liveness descriptor or timeout",
        )));
    }
    // SAFETY: F_GETFD only inspects the supplied descriptor.
    if unsafe { libc::fcntl(descriptor, libc::F_GETFD) } < 0 {
        return Err(ProcessError::Liveness(io::Error::last_os_error()));
    }
    // SAFETY: the validated inherited descriptor is uniquely transferred to this stream exactly
    // once at child startup.
    let stream = unsafe { UnixStream::from_raw_fd(descriptor) };
    stream
        .set_read_timeout(Some(timeout))
        .map_err(ProcessError::Liveness)?;
    std::thread::Builder::new()
        .name(String::from("analysis-parent-liveness"))
        .spawn(move || monitor_parent_liveness(stream))
        .map(|_| ())
        .map_err(ProcessError::Liveness)
}

#[cfg(not(unix))]
pub(crate) fn start_parent_liveness_monitor(
    _descriptor: i32,
    _timeout: Duration,
) -> Result<(), ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
}

#[cfg(unix)]
fn monitor_parent_liveness(mut stream: std::os::unix::net::UnixStream) -> ! {
    let mut buffer = [0_u8; 64];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => exit_after_liveness_loss(),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(_) => exit_after_liveness_loss(),
        }
    }
}

#[cfg(unix)]
fn exit_after_liveness_loss() -> ! {
    // SAFETY: _exit is async-signal-safe and intentionally skips process-wide destructors from the
    // monitor thread so a wedged calculation cannot delay termination.
    unsafe { libc::_exit(CHILD_PARENT_LIVENESS_LOST_EXIT_CODE) }
}

#[cfg(target_os = "linux")]
fn configure_parent_death_signal_before_exec(expected_parent_pid: libc::pid_t) -> io::Result<()> {
    // SAFETY: prctl/getppid operate on the current process without dereferencing pointers.
    if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // Close the race where the parent exits immediately before PR_SET_PDEATHSIG.
    // SAFETY: getppid reads process metadata and does not dereference pointers.
    if unsafe { libc::getppid() } != expected_parent_pid {
        // Avoid allocation in the post-fork/pre-exec closure.
        return Err(io::Error::from_raw_os_error(libc::ECHILD));
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn terminate_process_group(process_id: u32, signal: i32) -> Result<(), ProcessError> {
    let process_group = checked_process_id(process_id).map_err(ProcessError::Signal)?;
    signal_target(-process_group, signal).map_err(ProcessError::Signal)
}

/// Sends a signal to one positive process ID, treating an already-exited process as success.
///
/// This checked safe wrapper keeps operating-system FFI inside the process adapter while allowing
/// the cgroup adapter to implement the v1 hard-cleanup strategy.
///
/// # Errors
///
/// Returns an error for an invalid process ID or when the operating system rejects the signal.
#[cfg(unix)]
pub(crate) fn signal_process(process_id: u32, signal: i32) -> Result<(), io::Error> {
    let process = checked_process_id(process_id)?;
    signal_target(process, signal)
}

#[cfg(unix)]
fn checked_process_id(process_id: u32) -> Result<libc::pid_t, io::Error> {
    i32::try_from(process_id)
        .ok()
        .filter(|process_id| *process_id > 0)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid process id"))
}

#[cfg(unix)]
fn signal_target(target: libc::pid_t, signal: i32) -> Result<(), io::Error> {
    // SAFETY: kill receives a checked nonzero process or process-group identifier and no pointers.
    let result = unsafe { libc::kill(target, signal) };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ChildStopDeadlines {
    pub(crate) soft: tokio::time::Instant,
    pub(crate) reap: tokio::time::Instant,
    pub(crate) overall: tokio::time::Instant,
}

/// Resolves the TERM, hard-reap, and overall cleanup deadlines within one stop budget.
///
/// # Errors
///
/// Returns an error when the configured duration cannot be represented by the monotonic clock.
#[cfg(unix)]
pub(crate) fn child_stop_deadlines(grace: Duration) -> Result<ChildStopDeadlines, ProcessError> {
    if grace.is_zero() {
        return Err(ProcessError::StopTimeoutBound);
    }
    let started = tokio::time::Instant::now();
    let overall = started
        .checked_add(grace)
        .ok_or(ProcessError::StopTimeoutBound)?;
    let half = grace / 2;
    let soft = started
        .checked_add(half)
        .ok_or(ProcessError::StopTimeoutBound)?;
    let reap = started
        .checked_add(
            half.checked_add(grace / 4)
                .ok_or(ProcessError::StopTimeoutBound)?,
        )
        .ok_or(ProcessError::StopTimeoutBound)?;
    Ok(ChildStopDeadlines {
        soft,
        reap,
        overall,
    })
}

#[cfg(unix)]
async fn force_kill_and_reap_analysis_child(
    child: &mut tokio::process::Child,
    process_id: u32,
    deadline: tokio::time::Instant,
) -> Result<ExitStatus, ProcessError> {
    let signal_result = terminate_process_group(process_id, libc::SIGKILL);
    match tokio::time::timeout_at(deadline, child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(error)) => Err(ProcessError::Wait(error)),
        Err(_elapsed) => match signal_result {
            Ok(()) => Err(ProcessError::StopTimeout),
            Err(error) => Err(error),
        },
    }
}

/// Hard-stops every remaining member of a managed child's cgroup and waits for it to become empty.
///
/// The process-group signal is a best-effort fast path. The cgroup is the authoritative cleanup
/// boundary because a descendant can call `setsid`, leave the original process group, and remain in
/// the dedicated cgroup after its leader disappears.
///
/// Returns whether cleanup found a remaining process.
///
/// # Errors
///
/// Returns an error when cgroup inspection, signalling, or bounded cleanup fails.
#[cfg(unix)]
pub(crate) async fn stop_remaining_process_group(
    process_id: u32,
    cgroup: &ChildCgroup,
    deadline: tokio::time::Instant,
) -> Result<bool, ProcessError> {
    match cgroup.ensure_empty() {
        Ok(()) => return Ok(false),
        Err(CgroupError::UnexpectedProcess) => {}
        Err(error) => return Err(ProcessError::from(error)),
    }

    drop(terminate_process_group(process_id, libc::SIGKILL));
    let wait_until_empty = async {
        loop {
            cgroup.hard_kill().map_err(ProcessError::from)?;
            match cgroup.ensure_empty() {
                Ok(()) if tokio::time::Instant::now() <= deadline => return Ok(()),
                Ok(()) => return Err(ProcessError::StopTimeout),
                Err(CgroupError::UnexpectedProcess) => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                Err(error) => return Err(ProcessError::from(error)),
            }
        }
    };
    match tokio::time::timeout_at(deadline, wait_until_empty).await {
        Ok(result) => result?,
        Err(_elapsed) => return Err(ProcessError::StopTimeout),
    }
    Ok(true)
}

#[cfg(test)]
mod child_cleanup_tests {
    use std::io;

    #[cfg(unix)]
    use std::time::Duration;

    #[cfg(unix)]
    use super::child_stop_deadlines;
    use super::{ProcessError, resolve_spawn_setup_failure};

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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::{
        error::Error,
        fs,
        io::{self, BufRead, BufReader},
        os::unix::process::CommandExt,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    use tokio::process::Command as TokioCommand;

    use super::{drop_requires_group_kill, stop_remaining_process_group, terminate_process_group};
    use crate::cgroup::{CGROUP_DIRECTORY_NAME, CgroupHierarchy, ChildCgroup};

    #[test]
    fn drop_kills_when_leader_or_cgroup_cleanup_is_unverified() {
        assert!(!drop_requires_group_kill(true, true));
        assert!(drop_requires_group_kill(false, true));
        assert!(drop_requires_group_kill(true, false));
    }

    #[test]
    fn process_group_can_be_stopped_after_its_leader_was_reaped() -> Result<(), Box<dyn Error>> {
        let mut leader = Command::new("/bin/sh")
            .args(["-c", "sleep 30 & printf '%s\\n' \"$!\""])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()?;
        let process_group = leader.id();
        let stdout = leader
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("process-group fixture did not expose stdout"))?;
        let mut descendant = String::new();
        BufReader::new(stdout).read_line(&mut descendant)?;
        let descendant = descendant.trim().parse::<u32>()?;

        let status = leader.wait()?;
        assert!(status.success(), "process-group fixture leader failed");
        assert!(
            process_is_running(descendant),
            "fixture descendant exited early"
        );

        terminate_process_group(process_group, libc::SIGKILL)?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while process_is_running(descendant) {
            assert!(
                Instant::now() < deadline,
                "descendant remained alive after its reaped leader's group was killed"
            );
            thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    }

    #[tokio::test]
    async fn cgroup_hard_stop_reaches_a_process_that_escaped_the_original_group_with_setsid()
    -> Result<(), Box<dyn Error>> {
        let temporary = tempfile::tempdir()?;
        let directory = temporary.path().join(CGROUP_DIRECTORY_NAME);
        fs::create_dir(&directory)?;
        fs::write(directory.join("cgroup.procs"), "")?;
        fs::write(directory.join("memory.limit_in_bytes"), "201326592\n")?;
        fs::write(directory.join("memory.usage_in_bytes"), "4096\n")?;
        fs::write(directory.join("memory.max_usage_in_bytes"), "8192\n")?;
        fs::write(directory.join("memory.failcnt"), "0\n")?;
        fs::write(
            directory.join("memory.oom_control"),
            "oom_kill_disable 0\nunder_oom 0\noom_kill 0\n",
        )?;
        let cgroup =
            ChildCgroup::open_fixture(CgroupHierarchy::V1, directory.clone(), 201_326_592)?;

        let mut leader = TokioCommand::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .process_group(0)
            .spawn()?;
        let leader_id = leader
            .id()
            .ok_or_else(|| io::Error::other("fixture leader did not expose a process id"))?;
        let leader_group = i32::try_from(leader_id)?;
        let mut escaped_command = TokioCommand::new("/bin/sleep");
        escaped_command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_setsid_escape(&mut escaped_command, leader_group);
        let mut escaped = escaped_command.spawn()?;
        let escaped_id = escaped
            .id()
            .ok_or_else(|| io::Error::other("fixture member did not expose a process id"))?;
        let escape_deadline = Instant::now() + Duration::from_secs(5);
        while process_group_id(escaped_id) != Some(escaped_id) {
            if Instant::now() >= escape_deadline {
                return Err(io::Error::other(
                    "fixture member did not leave the original process group with setsid",
                )
                .into());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_ne!(
            process_group_id(escaped_id),
            Some(leader_id),
            "setsid fixture must escape the original process group"
        );

        // A regular file models the v1 membership snapshot. The process and setsid transition are
        // real Linux operations; this helper only mirrors the kernel removing a dead member from
        // cgroup.procs so the production bounded empty check can complete without root privileges.
        fs::write(directory.join("cgroup.procs"), escaped_id.to_string())?;
        let membership = directory.join("cgroup.procs");
        let membership_release = tokio::task::spawn_blocking(move || -> io::Result<()> {
            let deadline = Instant::now() + Duration::from_secs(5);
            while process_is_running(escaped_id) {
                if Instant::now() >= deadline {
                    return Err(io::Error::other(
                        "setsid fixture remained alive after cgroup hard cleanup",
                    ));
                }
                thread::sleep(Duration::from_millis(10));
            }
            fs::write(membership, "")
        });

        let found_remaining_process = stop_remaining_process_group(
            leader_id,
            &cgroup,
            tokio::time::Instant::now() + Duration::from_secs(5),
        )
        .await?;
        membership_release.await.map_err(io::Error::other)??;
        let _leader_status = leader.wait().await?;
        let _escaped_status = escaped.wait().await?;

        assert!(
            found_remaining_process,
            "hard cleanup must report the escaped cgroup member"
        );
        cgroup.ensure_empty()?;
        assert!(
            !process_is_running(escaped_id),
            "escaped cgroup member must be stopped"
        );
        Ok(())
    }

    fn process_is_running(process_id: u32) -> bool {
        fs::read_to_string(format!("/proc/{process_id}/stat"))
            .ok()
            .is_some_and(|status| {
                status
                    .split_whitespace()
                    .nth(2)
                    .is_some_and(|state| state != "Z")
            })
    }

    fn process_group_id(process_id: u32) -> Option<u32> {
        fs::read_to_string(format!("/proc/{process_id}/stat"))
            .ok()?
            .split_whitespace()
            .nth(4)?
            .parse::<u32>()
            .ok()
    }

    fn configure_setsid_escape(command: &mut TokioCommand, original_group: libc::pid_t) {
        // SAFETY: the closure calls only async-signal-safe process-group/session syscalls before
        // exec, using a checked positive group owned by another fixture child in the same session.
        unsafe {
            command.pre_exec(move || join_then_escape_process_group(original_group));
        }
    }

    fn join_then_escape_process_group(original_group: libc::pid_t) -> io::Result<()> {
        // SAFETY: pid 0 targets the calling pre-exec child and the checked group belongs to a
        // sibling fixture process in the same session.
        if unsafe { libc::setpgid(0, original_group) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: after joining a different process group the caller is not its group leader, so
        // setsid can create an isolated session without accessing memory or shared Rust state.
        if unsafe { libc::setsid() } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}
