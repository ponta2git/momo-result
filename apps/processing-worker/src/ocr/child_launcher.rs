use std::time::Duration;

#[cfg(target_os = "linux")]
use super::contract::{OcrHints, RequestedScreenType};

#[cfg(target_os = "linux")]
use momo_ocr::{OcrFailure, OcrOutput};

#[cfg(target_os = "linux")]
use super::consumer::OcrChildProcessFailure;

#[cfg(target_os = "linux")]
use super::{
    consumer::{OcrChildHandle, OcrChildLauncher, OcrChildTerminationFuture, OcrChildWaitFuture},
    contract::OcrQueuePayload,
    object_store::VerifiedSourceImage,
};

#[cfg(target_os = "linux")]
use std::{env, io, path::PathBuf, process::Stdio};
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
}

#[cfg(target_os = "linux")]
impl OcrChildLauncher for IsolatedOcrChildLauncher {
    fn launch(
        &self,
        image: &VerifiedSourceImage,
        payload: &OcrQueuePayload,
    ) -> Result<Box<dyn OcrChildHandle>, &'static str> {
        self.launch_image_bytes(
            image.bytes(),
            payload.requested_screen_type(),
            payload.hints(),
        )
        .map(|child| -> Box<dyn OcrChildHandle> { Box::new(child) })
    }
}

#[cfg(target_os = "linux")]
impl IsolatedOcrChildLauncher {
    pub(crate) const fn new(
        cgroup: crate::cgroup::ChildCgroup,
        tessdata_path: Option<PathBuf>,
        stop_grace: Duration,
    ) -> Self {
        Self {
            cgroup,
            tessdata_path,
            stop_grace,
        }
    }

    fn launch_image_bytes(
        &self,
        image: &[u8],
        requested_screen_type: RequestedScreenType,
        hints: &OcrHints,
    ) -> Result<ManagedOcrChild, &'static str> {
        if self.stop_grace.is_zero() {
            return Err("ocr_child_configuration");
        }
        let framed = momo_ocr::protocol::encode_request(
            crate::process::CHILD_START_MARKER,
            image,
            requested_screen_type,
            hints,
        )?;
        self.cgroup.ensure_empty().map_err(|error| error.kind())?;
        let memory_before = self.cgroup.snapshot().map_err(|error| error.kind())?;
        let executable = env::current_exe().map_err(|_error| "ocr_child_executable")?;
        let mut command = Command::new(executable);
        command
            .arg("child-ocr")
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
        let mut child = command.spawn().map_err(|_error| "ocr_child_spawn")?;
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
            start_error,
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
    start_error: Option<&'static str>,
}

#[cfg(target_os = "linux")]
impl OcrChildHandle for ManagedOcrChild {
    fn wait(&mut self) -> OcrChildWaitFuture<'_> {
        Box::pin(self.wait_inner())
    }

    fn terminate(&mut self) -> OcrChildTerminationFuture<'_> {
        Box::pin(self.terminate_inner())
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
                .map_err(OcrChildProcessFailure::Runtime)?;
            return Err(OcrChildProcessFailure::Runtime(kind));
        }
        let status = match self.child.as_mut() {
            Some(child) => child
                .wait()
                .await
                .map_err(|_error| OcrChildProcessFailure::Runtime("ocr_child_wait"))?,
            None => return Err(OcrChildProcessFailure::Runtime("ocr_child_state")),
        };
        drop(self.child.take());
        let memory_after = self
            .cgroup
            .snapshot()
            .map_err(|error| OcrChildProcessFailure::Runtime(error.kind()))?;
        self.cgroup
            .ensure_empty()
            .map_err(|error| OcrChildProcessFailure::Runtime(error.kind()))?;
        if memory_after.oom_kill_count > self.oom_kill_count_before {
            self.abort_io_tasks().await;
            return Err(OcrChildProcessFailure::ResourceExhausted);
        }
        if !status.success() {
            self.abort_io_tasks().await;
            return Err(OcrChildProcessFailure::Runtime("ocr_child_exit"));
        }
        self.finish_writer()
            .await
            .map_err(OcrChildProcessFailure::Runtime)?;
        let response = self
            .finish_reader()
            .await
            .map_err(OcrChildProcessFailure::Runtime)?;
        momo_ocr::protocol::decode_response(&response).map_err(OcrChildProcessFailure::Runtime)
    }

    async fn terminate_inner(&mut self) -> Result<(), &'static str> {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_status)) => {}
                Ok(None) => {
                    let _terminate_result =
                        crate::process::terminate_process_group(self.process_id, libc::SIGTERM);
                    match time::timeout(self.stop_grace, child.wait()).await {
                        Ok(Ok(_status)) => {}
                        Ok(Err(_wait_error)) => {
                            force_kill_and_reap(child, self.process_id, self.stop_grace).await?;
                            return Err("ocr_child_wait");
                        }
                        Err(_elapsed) => {
                            force_kill_and_reap(child, self.process_id, self.stop_grace).await?;
                        }
                    }
                }
                Err(_wait_error) => {
                    force_kill_and_reap(child, self.process_id, self.stop_grace).await?;
                    return Err("ocr_child_wait");
                }
            }
        }
        drop(self.child.take());
        self.abort_io_tasks().await;
        self.cgroup.ensure_empty().map_err(|error| error.kind())
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
    grace: Duration,
) -> Result<(), &'static str> {
    let signal_result = crate::process::terminate_process_group(process_id, libc::SIGKILL);
    match time::timeout(grace, child.wait()).await {
        Ok(Ok(_status)) => Ok(()),
        Ok(Err(_wait_error)) => Err("ocr_child_wait"),
        Err(_elapsed) => match signal_result {
            Ok(()) => Err("ocr_child_kill_timeout"),
            Err(error) => Err(error.kind()),
        },
    }
}

#[cfg(target_os = "linux")]
impl Drop for ManagedOcrChild {
    fn drop(&mut self) {
        if self.child.is_some() {
            drop(crate::process::terminate_process_group(
                self.process_id,
                libc::SIGKILL,
            ));
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
        let launcher = IsolatedOcrChildLauncher::new(cgroup, None, stop_grace);
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
            Ok(result) => result.map_err(process_failure_kind)?,
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
    let launcher = IsolatedOcrChildLauncher::new(cgroup, tessdata_path, stop_grace);
    let mut child = launcher.launch_image_bytes(image, requested_screen_type, hints)?;
    match time::timeout(timeout, child.wait_inner()).await {
        Ok(result) => result.map_err(process_failure_kind),
        Err(_elapsed) => {
            child.terminate_inner().await?;
            Err("ocr_child_pilot_timeout")
        }
    }
}

#[cfg(target_os = "linux")]
const fn process_failure_kind(failure: OcrChildProcessFailure) -> &'static str {
    match failure {
        OcrChildProcessFailure::Runtime(kind) => kind,
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
