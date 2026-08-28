use std::time::Duration;

#[cfg(target_os = "linux")]
use super::contract::{OcrHints, RequestedScreenType};

#[cfg(target_os = "linux")]
use momo_ocr::{OcrFailure, OcrOutput};

#[cfg(target_os = "linux")]
use super::consumer::OcrChildProcessFailure;

#[cfg(target_os = "linux")]
use super::{
    consumer::{
        OcrChildHandle, OcrChildLauncher, OcrChildLiveness, OcrChildTerminationFuture,
        OcrChildWaitFuture,
    },
    object_store::VerifiedSourceImage,
};

#[cfg(target_os = "linux")]
use std::{
    env, io,
    os::{fd::AsRawFd, unix::net::UnixStream},
    path::PathBuf,
    process::Stdio,
};
#[cfg(target_os = "linux")]
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    task::JoinHandle,
    time,
};

#[derive(Clone)]
#[cfg(target_os = "linux")]
pub(crate) struct IsolatedOcrChildLauncher {
    cgroup: crate::cgroup::ChildCgroup,
    tessdata_path: Option<PathBuf>,
    stop_grace: Duration,
    parent_liveness_timeout: Duration,
}

#[cfg(target_os = "linux")]
impl OcrChildLauncher for IsolatedOcrChildLauncher {
    fn launch(
        &self,
        image: &VerifiedSourceImage,
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
    ) -> Result<Box<dyn OcrChildHandle>, &'static str> {
        self.launch_image_bytes(image.bytes(), requested_screen_type, hints)
            .map(|child| -> Box<dyn OcrChildHandle> { Box::new(child) })
    }
}

#[cfg(target_os = "linux")]
impl IsolatedOcrChildLauncher {
    pub(crate) const fn new(
        cgroup: crate::cgroup::ChildCgroup,
        tessdata_path: Option<PathBuf>,
        stop_grace: Duration,
        parent_liveness_timeout: Duration,
    ) -> Self {
        Self {
            cgroup,
            tessdata_path,
            stop_grace,
            parent_liveness_timeout,
        }
    }

    fn launch_image_bytes(
        &self,
        image: &[u8],
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
    ) -> Result<ManagedOcrChild, &'static str> {
        if self.stop_grace.is_zero() || self.parent_liveness_timeout.is_zero() {
            return Err("ocr_child_configuration");
        }
        let parent_liveness_timeout_milliseconds =
            u64::try_from(self.parent_liveness_timeout.as_millis())
                .ok()
                .filter(|milliseconds| *milliseconds > 0)
                .ok_or("ocr_child_configuration")?;
        let framed = momo_ocr::protocol::encode_request(
            crate::process::CHILD_START_MARKER,
            image,
            requested_screen_type,
            hints,
        )?;
        self.cgroup.ensure_empty().map_err(|error| error.kind())?;
        let memory_before = self.cgroup.snapshot().map_err(|error| error.kind())?;
        let executable = env::current_exe().map_err(|_error| "ocr_child_executable")?;
        let (parent_liveness, child_liveness) =
            UnixStream::pair().map_err(|_error| "ocr_child_liveness")?;
        parent_liveness
            .set_nonblocking(true)
            .map_err(|_error| "ocr_child_liveness")?;
        let child_liveness_fd = child_liveness.as_raw_fd();
        let mut command = Command::new(executable);
        command
            .arg("child-ocr")
            .arg("--parent-liveness-fd")
            .arg(child_liveness_fd.to_string())
            .arg("--parent-liveness-timeout-ms")
            .arg(parent_liveness_timeout_milliseconds.to_string())
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .process_group(0);
        if let Some(path) = &self.tessdata_path {
            command.arg("--tessdata-path").arg(path);
        }
        preserve_native_runtime_environment(&mut command);
        crate::process::configure_parent_death_signal(&mut command);
        crate::process::configure_inherited_liveness(&mut command, child_liveness_fd);
        let mut child = command.spawn().map_err(|_error| "ocr_child_spawn")?;
        drop(child_liveness);
        let process_id = child.id().ok_or("ocr_child_process_id")?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let start_error = match (&stdin, &stdout) {
            (None, _) => Some("ocr_child_stdin"),
            (_, None) => Some("ocr_child_stdout"),
            (Some(_), Some(_)) => self
                .cgroup
                .attach(process_id)
                .err()
                .map(|error| error.kind()),
        };
        let writer = if start_error.is_none() {
            stdin.map(|input| tokio::spawn(write_framed_input(input, framed)))
        } else {
            drop(stdin);
            None
        };
        let reader = stdout.map(|output| tokio::spawn(read_bounded_output(output)));
        Ok(ManagedOcrChild {
            child: Some(child),
            process_id,
            cgroup: self.cgroup.clone(),
            oom_kill_count_before: memory_before.oom_kill_count,
            stop_grace: self.stop_grace,
            writer,
            reader,
            parent_liveness,
            start_error,
            cleanup_complete: false,
        })
    }
}

#[cfg(target_os = "linux")]
struct ManagedOcrChild {
    child: Option<tokio::process::Child>,
    process_id: u32,
    cgroup: crate::cgroup::ChildCgroup,
    oom_kill_count_before: u64,
    stop_grace: Duration,
    writer: Option<JoinHandle<Result<(), io::Error>>>,
    reader: Option<JoinHandle<Result<Vec<u8>, io::Error>>>,
    parent_liveness: UnixStream,
    start_error: Option<&'static str>,
    cleanup_complete: bool,
}

#[cfg(target_os = "linux")]
impl OcrChildHandle for ManagedOcrChild {
    fn liveness(&self) -> Result<Box<dyn OcrChildLiveness>, &'static str> {
        self.parent_liveness
            .try_clone()
            .map(|stream| -> Box<dyn OcrChildLiveness> {
                Box::new(ParentLivenessHandle { stream })
            })
            .map_err(|_error| "ocr_child_liveness")
    }

    fn wait(&mut self) -> OcrChildWaitFuture<'_> {
        Box::pin(self.wait_inner())
    }

    fn terminate(&mut self) -> OcrChildTerminationFuture<'_> {
        Box::pin(self.terminate_inner())
    }
}

#[cfg(target_os = "linux")]
struct ParentLivenessHandle {
    stream: UnixStream,
}

#[cfg(target_os = "linux")]
impl OcrChildLiveness for ParentLivenessHandle {
    fn refresh(&mut self) -> Result<(), &'static str> {
        match io::Write::write(&mut self.stream, &[1]) {
            Ok(1) => Ok(()),
            Ok(_) => Err("ocr_child_liveness"),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(()),
            Err(_error) => Err("ocr_child_liveness"),
        }
    }
}

#[cfg(target_os = "linux")]
impl ManagedOcrChild {
    async fn wait_inner(
        &mut self,
    ) -> Result<Result<OcrOutput, OcrFailure>, OcrChildProcessFailure> {
        if let Some(kind) = self.start_error.take() {
            self.terminate_inner()
                .await
                .map_err(OcrChildProcessFailure::ProcessBoundary)?;
            return Err(OcrChildProcessFailure::ProcessBoundary(kind));
        }
        let wait_result = match self.child.as_mut() {
            Some(child) => child.wait().await,
            None => return Err(OcrChildProcessFailure::ProcessBoundary("ocr_child_state")),
        };
        let status = match wait_result {
            Ok(status) => status,
            Err(_wait_error) => {
                self.terminate_inner()
                    .await
                    .map_err(OcrChildProcessFailure::ProcessBoundary)?;
                return Err(OcrChildProcessFailure::ProcessBoundary("ocr_child_wait"));
            }
        };
        drop(self.child.take());
        let cleanup_deadline = crate::process::child_stop_deadlines(self.stop_grace)
            .map_err(|error| OcrChildProcessFailure::ProcessBoundary(error.kind()))?
            .overall;
        let memory_after = self.cgroup.snapshot();
        let remaining_process = crate::process::stop_remaining_process_group(
            self.process_id,
            &self.cgroup,
            cleanup_deadline,
        )
        .await;
        let remaining_process = match remaining_process {
            Ok(value) => {
                self.cleanup_complete = true;
                value
            }
            Err(error) => {
                self.abort_io_tasks().await;
                return Err(OcrChildProcessFailure::ProcessBoundary(error.kind()));
            }
        };
        let memory_after = match memory_after {
            Ok(value) => value,
            Err(error) => {
                self.abort_io_tasks().await;
                return Err(OcrChildProcessFailure::ProcessBoundary(error.kind()));
            }
        };
        if remaining_process {
            self.abort_io_tasks().await;
            return Err(OcrChildProcessFailure::ProcessBoundary(
                "cgroup_unexpected_process",
            ));
        }
        if memory_after.oom_kill_count > self.oom_kill_count_before {
            self.abort_io_tasks().await;
            return Err(OcrChildProcessFailure::ResourceExhausted);
        }
        if !status.success() {
            self.abort_io_tasks().await;
            return Err(OcrChildProcessFailure::ProcessBoundary("ocr_child_exit"));
        }
        if let Err(kind) = self.finish_writer().await {
            self.abort_io_tasks().await;
            return Err(OcrChildProcessFailure::ProcessBoundary(kind));
        }
        let response = match self.finish_reader().await {
            Ok(response) => response,
            Err(kind) => {
                self.abort_io_tasks().await;
                return Err(OcrChildProcessFailure::ProcessBoundary(kind));
            }
        };
        momo_ocr::protocol::decode_response(&response)
            .map_err(OcrChildProcessFailure::ProcessBoundary)
    }

    async fn terminate_inner(&mut self) -> Result<(), &'static str> {
        let deadlines =
            crate::process::child_stop_deadlines(self.stop_grace).map_err(|error| error.kind())?;
        let mut termination_failure = None;
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_status)) => {}
                Ok(None) => {
                    let _terminate_result =
                        crate::process::terminate_process_group(self.process_id, libc::SIGTERM);
                    match time::timeout_at(deadlines.soft, child.wait()).await {
                        Ok(Ok(_status)) => {}
                        Ok(Err(_wait_error)) => {
                            termination_failure =
                                force_kill_and_reap(child, self.process_id, deadlines.reap)
                                    .await
                                    .err()
                                    .or(Some("ocr_child_wait"));
                        }
                        Err(_elapsed) => {
                            termination_failure =
                                force_kill_and_reap(child, self.process_id, deadlines.reap)
                                    .await
                                    .err();
                        }
                    }
                }
                Err(_wait_error) => {
                    termination_failure =
                        force_kill_and_reap(child, self.process_id, deadlines.reap)
                            .await
                            .err()
                            .or(Some("ocr_child_wait"));
                }
            }
        }
        drop(self.child.take());
        self.abort_io_tasks().await;
        crate::process::stop_remaining_process_group(
            self.process_id,
            &self.cgroup,
            deadlines.overall,
        )
        .await
        .map_err(|error| error.kind())?;
        self.cleanup_complete = true;
        termination_failure.map_or(Ok(()), Err)
    }

    async fn finish_writer(&mut self) -> Result<(), &'static str> {
        let task = self.writer.take().ok_or("ocr_child_input_task")?;
        task.await
            .map_err(|_error| "ocr_child_input_task")?
            .map_err(|_error| "ocr_child_input_write")
    }

    async fn finish_reader(&mut self) -> Result<Vec<u8>, &'static str> {
        let task = self.reader.take().ok_or("ocr_child_output_task")?;
        task.await
            .map_err(|_error| "ocr_child_output_task")?
            .map_err(|_error| "ocr_child_output_read")
    }

    async fn abort_io_tasks(&mut self) {
        if let Some(writer) = self.writer.take() {
            writer.abort();
            drop(writer.await);
        }
        if let Some(reader) = self.reader.take() {
            reader.abort();
            drop(reader.await);
        }
    }
}

#[cfg(target_os = "linux")]
async fn force_kill_and_reap(
    child: &mut tokio::process::Child,
    process_id: u32,
    deadline: time::Instant,
) -> Result<(), &'static str> {
    let signal_result = crate::process::terminate_process_group(process_id, libc::SIGKILL);
    match time::timeout_at(deadline, child.wait()).await {
        Ok(Ok(_status)) => Ok(()),
        Ok(Err(_wait_error)) => Err("ocr_child_wait"),
        Err(_elapsed) => match signal_result {
            Ok(()) => Err("child_stop_timeout"),
            Err(error) => Err(error.kind()),
        },
    }
}

#[cfg(target_os = "linux")]
impl Drop for ManagedOcrChild {
    fn drop(&mut self) {
        if !self.cleanup_complete {
            drop(crate::process::terminate_process_group(
                self.process_id,
                libc::SIGKILL,
            ));
            // A child can leave its original process group with setsid while remaining in the
            // dedicated cgroup. Drop cannot await verification, so run the same authoritative
            // cgroup-wide hard-stop pass as a synchronous fail-closed fallback.
            drop(self.cgroup.hard_kill());
        }
        if let Some(writer) = &self.writer {
            writer.abort();
        }
        if let Some(reader) = &self.reader {
            reader.abort();
        }
    }
}

#[cfg(target_os = "linux")]
fn preserve_native_runtime_environment(command: &mut Command) {
    crate::process::preserve_dynamic_runtime_environment(command);
    if let Some(value) = env::var_os("TESSDATA_PREFIX") {
        command.env("TESSDATA_PREFIX", value);
    }
}

#[cfg(target_os = "linux")]
async fn write_framed_input(
    mut stdin: tokio::process::ChildStdin,
    framed: Vec<u8>,
) -> Result<(), io::Error> {
    stdin.write_all(&framed).await?;
    stdin.shutdown().await?;
    drop(stdin);
    Ok(())
}

#[cfg(target_os = "linux")]
async fn read_bounded_output(stdout: tokio::process::ChildStdout) -> Result<Vec<u8>, io::Error> {
    let limit = u64::try_from(momo_ocr::protocol::MAXIMUM_RESPONSE_BYTES)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let mut bounded = stdout.take(limit.saturating_add(1));
    let mut bytes = Vec::new();
    bounded.read_to_end(&mut bytes).await?;
    if bytes.len() > momo_ocr::protocol::MAXIMUM_RESPONSE_BYTES {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "OCR child output exceeded its byte bound",
        ))
    } else {
        Ok(bytes)
    }
}

/// Verifies that an isolated OCR child can be cancelled, reaped, and followed by a second child.
///
/// # Errors
///
/// Returns an opaque process-boundary category when identity, cgroup, framing, cleanup, or the
/// expected decode-failure response violates the child protocol contract.
pub(crate) async fn probe_isolated_child_lifecycle(
    timeout: Duration,
    stop_grace: Duration,
) -> Result<(), &'static str> {
    #[cfg(target_os = "linux")]
    {
        if timeout.is_zero() || stop_grace.is_zero() || !crate::process::worker_identity_supported()
        {
            return Err("ocr_child_probe_configuration");
        }
        let cgroup = child_cgroup_from_environment("ocr_child_probe_configuration")?;
        let parent_liveness_timeout = timeout
            .checked_add(stop_grace)
            .ok_or("ocr_child_probe_configuration")?;
        let launcher =
            IsolatedOcrChildLauncher::new(cgroup, None, stop_grace, parent_liveness_timeout);
        let input = b"not-an-image";
        let mut cancelled_child = launcher.launch_image_bytes(
            input,
            RequestedScreenType::TotalAssets,
            &OcrHints::default(),
        )?;
        cancelled_child.terminate_inner().await?;

        let mut completed_child = launcher.launch_image_bytes(
            input,
            RequestedScreenType::TotalAssets,
            &OcrHints::default(),
        )?;
        let result = match time::timeout(timeout, completed_child.wait_inner()).await {
            Ok(Ok(result)) => result,
            Ok(Err(failure)) => {
                completed_child.terminate_inner().await?;
                return Err(process_failure_kind(failure));
            }
            Err(_elapsed) => {
                completed_child.terminate_inner().await?;
                return Err("ocr_child_probe_timeout");
            }
        };
        if matches!(result, Err(OcrFailure::DecodeFailed)) {
            Ok(())
        } else {
            Err("ocr_child_probe_outcome")
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (timeout, stop_grace);
        Err("ocr_child_platform")
    }
}

/// Runs one bounded local pilot through the production OCR process boundary.
///
/// # Errors
///
/// Returns an opaque process-boundary category when cgroup setup, child lifecycle, or the timeout
/// contract fails. OCR-domain failures remain a closed inner result.
#[cfg(target_os = "linux")]
pub(crate) async fn analyze_isolated_local_image_bytes(
    image: &[u8],
    requested_screen_type: RequestedScreenType,
    hints: &OcrHints,
    tessdata_path: Option<PathBuf>,
    timeout: Duration,
    stop_grace: Duration,
) -> Result<Result<OcrOutput, OcrFailure>, &'static str> {
    if timeout.is_zero() || stop_grace.is_zero() || !crate::process::worker_identity_supported() {
        return Err("ocr_child_pilot_configuration");
    }
    let cgroup = child_cgroup_from_environment("ocr_child_pilot_configuration")?;
    let parent_liveness_timeout = timeout
        .checked_add(stop_grace)
        .ok_or("ocr_child_pilot_configuration")?;
    let launcher =
        IsolatedOcrChildLauncher::new(cgroup, tessdata_path, stop_grace, parent_liveness_timeout);
    let mut child = launcher.launch_image_bytes(image, requested_screen_type, hints)?;
    match time::timeout(timeout, child.wait_inner()).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(failure)) => {
            child.terminate_inner().await?;
            Err(process_failure_kind(failure))
        }
        Err(_elapsed) => {
            child.terminate_inner().await?;
            Err("ocr_child_pilot_timeout")
        }
    }
}

#[cfg(target_os = "linux")]
const fn process_failure_kind(failure: OcrChildProcessFailure) -> &'static str {
    match failure {
        OcrChildProcessFailure::ProcessBoundary(kind) => kind,
        OcrChildProcessFailure::ResourceExhausted => "ocr_child_resource_exhausted",
    }
}

#[cfg(target_os = "linux")]
fn child_cgroup_from_environment(
    configuration_error: &'static str,
) -> Result<crate::cgroup::ChildCgroup, &'static str> {
    let child_limit = env::var(crate::series_analysis::config::CHILD_MEMORY_LIMIT_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or(configuration_error)?;
    crate::cgroup::ChildCgroup::from_environment(child_limit).map_err(|error| error.kind())
}
