use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::ExitStatus,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub(crate) const RESOURCE_LIMIT_HIT_EXIT_CODE: i32 = 73;
pub(crate) const CHILD_SUPERSEDED_EXIT_CODE: i32 = 78;
pub(crate) const CHILD_INPUT_INVALID_EXIT_CODE: i32 = 79;
pub(crate) const CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE: i32 = 80;
pub(crate) const CHILD_CALCULATION_FAILED_EXIT_CODE: i32 = 81;
pub(crate) const CHILD_DEPENDENCY_FAILED_EXIT_CODE: i32 = 82;
pub(crate) const CHILD_PARENT_LIVENESS_LOST_EXIT_CODE: i32 = 83;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AnalysisChildSpec {
    pub read_database_url: String,
    pub game_title_id: String,
    pub input_revision: i64,
    pub artifact_id: String,
    pub output_directory: PathBuf,
    pub maximum_chunk_bytes: u64,
    pub maximum_chunk_count: u64,
    pub maximum_total_bytes: u64,
    pub maximum_file_count: u64,
    pub parent_liveness_timeout: Duration,
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
    #[cfg(unix)]
    parent_liveness: std::os::unix::net::UnixStream,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeOutcome {
    ResourceLimitEnforced,
    ChildCompleted,
    TimedOut,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardLimitProbeResult {
    pub outcome: ProbeOutcome,
    pub parent_survived: bool,
    pub child_exit_code: Option<i32>,
    pub child_signal: Option<i32>,
}

pub struct ParentDeathProbe {
    process_id: u32,
    _child: tokio::process::Child,
    #[cfg(unix)]
    _parent_liveness: std::os::unix::net::UnixStream,
}

impl ParentDeathProbe {
    #[must_use]
    pub const fn process_id(&self) -> u32 {
        self.process_id
    }
}

#[derive(Debug, Error)]
pub enum ProcessError {
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
    #[error("child process did not expose a process id")]
    MissingProcessId,
    #[error("failed to establish or refresh child liveness: {0}")]
    Liveness(io::Error),
    #[error("child liveness timeout exceeds a supported bound")]
    LivenessTimeoutBound,
    #[error("child liveness timeout conversion exceeds a supported bound")]
    LivenessTimeoutConversion(#[from] std::num::TryFromIntError),
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
            Self::MissingProcessId => "child_process_id_missing",
            Self::Liveness(_) => "child_liveness",
            Self::LivenessTimeoutBound => "child_liveness_timeout_bound",
            Self::LivenessTimeoutConversion(_) => "child_liveness_timeout_conversion",
        }
    }
}

impl ManagedAnalysisChild {
    /// Starts the calculation subprocess with an isolated environment, process group, and hard
    /// address-space limit.
    ///
    /// # Errors
    ///
    /// Returns an error when the current executable cannot be resolved or the child cannot start.
    #[cfg(target_os = "linux")]
    pub(crate) fn spawn(
        spec: &AnalysisChildSpec,
        memory_limit_bytes: u64,
    ) -> Result<Self, ProcessError> {
        use std::os::fd::AsRawFd;
        use std::os::unix::net::UnixStream;
        use std::process::Stdio;

        use tokio::process::Command;

        let executable = std::env::current_exe().map_err(ProcessError::CurrentExecutable)?;
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
        let mut command = Command::new(executable);
        command
            .arg("child-compute")
            .arg("--game-title-id")
            .arg(&spec.game_title_id)
            .arg("--input-revision")
            .arg(spec.input_revision.to_string())
            .arg("--artifact-id")
            .arg(&spec.artifact_id)
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
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .process_group(0);
        configure_memory_limit(&mut command, memory_limit_bytes);
        configure_inherited_liveness(&mut command, child_liveness_fd);
        let child = command.spawn().map_err(ProcessError::Spawn)?;
        drop(child_liveness);
        let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;
        Ok(Self {
            child,
            process_id,
            peak_resident_bytes: None,
            parent_liveness,
        })
    }

    /// Reports that managed calculation children require the production Linux isolation contract.
    ///
    /// # Errors
    ///
    /// Always returns [`ProcessError::UnsupportedPlatform`].
    #[cfg(not(target_os = "linux"))]
    pub(crate) const fn spawn(
        _spec: &AnalysisChildSpec,
        _memory_limit_bytes: u64,
    ) -> Result<Self, ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }

    #[must_use]
    pub(crate) const fn peak_resident_bytes(&self) -> Option<u64> {
        self.peak_resident_bytes
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
        self.child
            .try_wait()
            .map(|status| status.map(classify_analysis_status))
            .map_err(ProcessError::Wait)
    }

    /// Stops the child process group, gives it a bounded grace period, and always reaps it.
    ///
    /// # Errors
    ///
    /// Returns an error when signalling or reaping the child fails.
    #[cfg(unix)]
    pub(crate) async fn terminate(&mut self, grace: Duration) -> Result<ExitStatus, ProcessError> {
        use tokio::time;

        if let Some(status) = self.child.try_wait().map_err(ProcessError::Wait)? {
            return Ok(status);
        }
        terminate_process_group(self.process_id, libc::SIGTERM)?;
        if let Ok(result) = time::timeout(grace, self.child.wait()).await {
            return result.map_err(ProcessError::Wait);
        }
        terminate_process_group(self.process_id, libc::SIGKILL)?;
        self.child.wait().await.map_err(ProcessError::Wait)
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

/// Returns whether this host implements the complete production child-isolation contract.
#[must_use]
pub(crate) const fn managed_analysis_runtime_supported() -> bool {
    cfg!(target_os = "linux")
}

fn classify_analysis_status(status: ExitStatus) -> AnalysisChildOutcome {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        if status.signal().is_some_and(is_resource_signal) {
            return AnalysisChildOutcome::ResourceExhausted;
        }
    }
    match status.code() {
        Some(0) => AnalysisChildOutcome::Succeeded,
        Some(CHILD_SUPERSEDED_EXIT_CODE) => AnalysisChildOutcome::Superseded,
        Some(CHILD_INPUT_INVALID_EXIT_CODE) => AnalysisChildOutcome::InputInvalid,
        Some(CHILD_ARTIFACT_TOO_LARGE_EXIT_CODE) => AnalysisChildOutcome::ArtifactTooLarge,
        Some(RESOURCE_LIMIT_HIT_EXIT_CODE) => AnalysisChildOutcome::ResourceExhausted,
        Some(CHILD_DEPENDENCY_FAILED_EXIT_CODE) => AnalysisChildOutcome::DependencyFailed,
        Some(CHILD_PARENT_LIVENESS_LOST_EXIT_CODE) => AnalysisChildOutcome::ParentLivenessLost,
        _ => AnalysisChildOutcome::CalculationFailed,
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
/// Runs a child allocation behind an operating-system address-space limit.
///
/// # Errors
///
/// Returns an error when the child cannot be spawned, signalled, or reaped.
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
    configure_memory_limit(&mut command, limit_bytes);

    let mut child = command.spawn().map_err(ProcessError::Spawn)?;
    let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;

    let status = if let Ok(result) = time::timeout(timeout, child.wait()).await {
        result.map_err(ProcessError::Wait)?
    } else {
        terminate_process_group(process_id, libc::SIGTERM)?;
        let status = if let Ok(result) = time::timeout(Duration::from_secs(1), child.wait()).await {
            result.map_err(ProcessError::Wait)?
        } else {
            terminate_process_group(process_id, libc::SIGKILL)?;
            child.wait().await.map_err(ProcessError::Wait)?
        };
        return Ok(probe_result(ProbeOutcome::TimedOut, status));
    };

    let outcome = if status.code() == Some(RESOURCE_LIMIT_HIT_EXIT_CODE)
        || status.signal().is_some_and(is_resource_signal)
    {
        ProbeOutcome::ResourceLimitEnforced
    } else {
        ProbeOutcome::ChildCompleted
    };
    Ok(probe_result(outcome, status))
}

#[cfg(unix)]
/// Spawns a child that receives a death signal if this parent disappears.
///
/// # Errors
///
/// Returns an error when the executable cannot be resolved or the child cannot be spawned.
pub fn spawn_parent_death_probe() -> Result<ParentDeathProbe, ProcessError> {
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
pub fn spawn_parent_death_probe() -> Result<ParentDeathProbe, ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
}

#[cfg(not(unix))]
/// Reports that the hard-limit probe is unavailable on non-Unix hosts.
///
/// # Errors
///
/// Always returns [`ProcessError::UnsupportedPlatform`].
pub async fn run_hard_limit_probe(
    _limit_bytes: u64,
    _allocation_bytes: u64,
    _timeout: Duration,
) -> Result<HardLimitProbeResult, ProcessError> {
    Err(ProcessError::UnsupportedPlatform)
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

#[cfg(unix)]
fn configure_memory_limit(command: &mut tokio::process::Command, limit_bytes: u64) {
    #[cfg(target_os = "linux")]
    // SAFETY: getpid has no preconditions and does not dereference pointers.
    let expected_parent_pid = unsafe { libc::getpid() };
    // SAFETY: the closure only invokes async-signal-safe wrappers before exec.
    unsafe {
        command.pre_exec(move || {
            set_address_space_limit(limit_bytes)?;
            #[cfg(target_os = "linux")]
            configure_parent_death_signal_before_exec(expected_parent_pid)?;
            Ok(())
        });
    }
}

#[cfg(unix)]
fn configure_inherited_liveness(command: &mut tokio::process::Command, descriptor: i32) {
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
fn set_address_space_limit(limit_bytes: u64) -> io::Result<()> {
    let limit = libc::rlimit {
        rlim_cur: limit_bytes,
        rlim_max: limit_bytes,
    };
    // SAFETY: the pointer references a live `rlimit` value for the duration of the syscall.
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &raw const limit) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
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
pub fn start_parent_liveness_monitor(
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
pub fn start_parent_liveness_monitor(
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
fn terminate_process_group(process_id: u32, signal: i32) -> Result<(), ProcessError> {
    let process_group = i32::try_from(process_id).map_err(|conversion_error| {
        ProcessError::Signal(io::Error::new(
            io::ErrorKind::InvalidInput,
            conversion_error,
        ))
    })?;
    // SAFETY: kill with a negative pid targets the child-owned process group created at spawn.
    let result = unsafe { libc::kill(-process_group, signal) };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(ProcessError::Signal(error))
    }
}

#[cfg(unix)]
#[must_use]
pub fn allocate_and_touch(bytes: u64) -> i32 {
    let Ok(length) = usize::try_from(bytes) else {
        return RESOURCE_LIMIT_HIT_EXIT_CODE;
    };
    let Some(mapping) = AnonymousMapping::new(length) else {
        return RESOURCE_LIMIT_HIT_EXIT_CODE;
    };
    // SAFETY: sysconf reads a process-global constant and has no pointer preconditions.
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    let Ok(page_size) = usize::try_from(page_size) else {
        return 74;
    };
    if page_size == 0 {
        return 74;
    }
    mapping.touch_pages(page_size);
    if mapping.release() { 0 } else { 75 }
}

#[cfg(unix)]
struct AnonymousMapping {
    pointer: Option<std::ptr::NonNull<libc::c_void>>,
    length: usize,
}

#[cfg(unix)]
impl AnonymousMapping {
    fn new(length: usize) -> Option<Self> {
        // SAFETY: the arguments request a private anonymous mapping and contain no borrowed
        // pointers. A successful mapping is owned by the returned guard.
        let pointer = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                length,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
                -1,
                0,
            )
        };
        if pointer == libc::MAP_FAILED {
            return None;
        }
        std::ptr::NonNull::new(pointer).map(|pointer| Self {
            pointer: Some(pointer),
            length,
        })
    }

    fn touch_pages(&self, page_size: usize) {
        let Some(pointer) = self.pointer else {
            return;
        };
        let bytes = pointer.as_ptr().cast::<u8>();
        for offset in (0..self.length).step_by(page_size) {
            let address = bytes.wrapping_add(offset);
            // SAFETY: `offset` is strictly below the owned mapping length.
            unsafe { std::ptr::write_volatile(address, 1) };
        }
    }

    fn release(mut self) -> bool {
        let Some(pointer) = self.pointer.take() else {
            return true;
        };
        // SAFETY: the guard owns this mapping and clears the pointer before `Drop` can run.
        let result = unsafe { libc::munmap(pointer.as_ptr(), self.length) };
        result == 0
    }
}

#[cfg(unix)]
impl Drop for AnonymousMapping {
    fn drop(&mut self) {
        if let Some(pointer) = self.pointer.take() {
            // SAFETY: the guard still owns this mapping; cleanup errors cannot be reported from
            // `Drop`, but the explicit success path uses `release` when the result matters.
            unsafe {
                libc::munmap(pointer.as_ptr(), self.length);
            }
        }
    }
}

#[cfg(not(unix))]
#[must_use]
pub fn allocate_and_touch(_bytes: u64) -> i32 {
    76
}
