//! A live process barrier. Receipts never infer another process's state from CLI environment.

use std::{
    io,
    os::unix::fs::{FileTypeExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use clap::ValueEnum;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::watch,
    time::{self, Instant},
};

const SOCKET_PATH: &str = "/tmp/momo-worker-maintenance.sock";
const TOKEN_ENV: &str = "MOMO_MAINTENANCE_OPERATIONS_TOKEN";
const MAXIMUM_FRAME: u64 = 2048;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Stage {
    Admission,
    All,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) cutover_id: String,
    pub(crate) stop_epoch: u64,
    pub(crate) stage: Stage,
}

impl Request {
    pub(crate) fn valid(&self) -> bool {
        let mut bytes = self.cutover_id.bytes();
        (1..=64).contains(&self.cutover_id.len())
            && bytes
                .next()
                .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            && (1..=9_007_199_254_740_991).contains(&self.stop_epoch)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Active,
    Draining,
    Drained,
    TimedOut,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Failure {
    DrainTimeout,
    DrainFailed,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Writer {
    name: String,
    stage: Stage,
    status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<Failure>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InFlight {
    pub(crate) operations: u8,
    pub(crate) attempts: u8,
    pub(crate) reconciliations: u8,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Snapshot {
    consumer: String,
    scope: String,
    mode: String,
    process_id: u32,
    cutover_id: Option<String>,
    stop_epoch: Option<u64>,
    stage: Option<Stage>,
    phase: String,
    writers: Vec<Writer>,
    in_flight: InFlight,
}

impl Snapshot {
    /// Binds an explicitly scoped operation to the running frozen daemon's settled barrier.
    pub(crate) fn frozen_process(&self, cutover_id: &str, stop_epoch: u64) -> Option<u32> {
        (self.mode == "frozen"
            && self.consumer == "momo-processing-worker"
            && self.scope == "process"
            && self.cutover_id.as_deref() == Some(cutover_id)
            && self.stop_epoch == Some(stop_epoch)
            && self.stage == Some(Stage::All)
            && self.phase == "drained"
            && self.writers.len() == 2
            && self
                .writers
                .iter()
                .zip([
                    ("scheduler_and_attempts", Stage::Admission),
                    ("runtime_and_notifications", Stage::All),
                ])
                .all(|(writer, (name, stage))| {
                    writer.name == name
                        && writer.stage == stage
                        && writer.status == Status::Drained
                        && writer.failure.is_none()
                })
            && self.in_flight == InFlight::default())
        .then_some(self.process_id)
    }
}

struct State {
    request: Option<Request>,
    admission: Status,
    runtime: Status,
    admission_deadline: Option<Instant>,
    all_deadline: Option<Instant>,
    frozen: bool,
    in_flight: InFlight,
}

impl State {
    fn expire(&mut self) {
        let now = Instant::now();
        if self.admission == Status::Draining
            && self
                .admission_deadline
                .is_some_and(|deadline| deadline <= now)
        {
            self.admission = Status::TimedOut;
        }
        if self.runtime == Status::Draining
            && self.all_deadline.is_some_and(|deadline| deadline <= now)
        {
            self.runtime = Status::TimedOut;
        }
    }

    fn phase(&self) -> &'static str {
        if self.request.is_none() {
            return "running";
        }
        let selected = [
            self.admission,
            if self
                .request
                .as_ref()
                .is_some_and(|request| request.stage == Stage::All)
            {
                self.runtime
            } else {
                Status::Drained
            },
        ];
        if selected.contains(&Status::Failed) {
            "failed"
        } else if selected.contains(&Status::TimedOut) {
            "timed_out"
        } else if selected.iter().all(|status| *status == Status::Drained) {
            "drained"
        } else {
            "draining"
        }
    }
}

#[derive(Clone)]
pub(crate) struct Control {
    state: Arc<Mutex<State>>,
    admission: watch::Sender<bool>,
    all: watch::Sender<bool>,
    timeout: Duration,
}

impl Control {
    pub(crate) fn new(frozen: bool, timeout: Duration) -> Self {
        let (admission, _) = watch::channel(false);
        let (all, _) = watch::channel(false);
        Self {
            state: Arc::new(Mutex::new(State {
                request: None,
                admission: Status::Active,
                runtime: Status::Active,
                admission_deadline: None,
                all_deadline: None,
                frozen,
                in_flight: InFlight::default(),
            })),
            admission,
            all,
            timeout,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| {
            let mut state = poisoned.into_inner();
            state.admission = Status::Failed;
            state.runtime = Status::Failed;
            self.admission.send_replace(true);
            self.all.send_replace(true);
            state
        })
    }

    pub(crate) fn admission_receiver(&self) -> watch::Receiver<bool> {
        self.admission.subscribe()
    }

    pub(crate) fn all_receiver(&self) -> watch::Receiver<bool> {
        self.all.subscribe()
    }

    pub(crate) fn admission_closed(&self) -> bool {
        *self.admission.borrow()
    }

    pub(crate) fn all_requested(&self) -> bool {
        *self.all.borrow()
    }

    pub(crate) fn request(&self, input: Request) -> Result<(), ErrorCode> {
        if !input.valid() {
            return Err(ErrorCode::InvalidInput);
        }
        let mut state = self.lock();
        state.expire();
        if state.request.as_ref().is_some_and(|existing| {
            existing.cutover_id != input.cutover_id
                || existing.stop_epoch != input.stop_epoch
                || (existing.stage == Stage::All && input.stage == Stage::Admission)
        }) {
            return Err(ErrorCode::CutoverConflict);
        }
        if state.admission == Status::Active {
            state.admission_deadline = Some(Instant::now() + self.timeout);
            state.admission = if state.frozen {
                Status::Drained
            } else {
                Status::Draining
            };
        }
        self.admission.send_replace(true);
        if input.stage == Stage::All {
            if state.runtime == Status::Active {
                state.all_deadline = Some(Instant::now() + self.timeout);
                state.runtime = if state.frozen {
                    Status::Drained
                } else {
                    Status::Draining
                };
            }
            self.all.send_replace(true);
        }
        state.request = Some(input);
        drop(state);
        Ok(())
    }

    pub(crate) fn counts(&self, counts: InFlight) {
        self.lock().in_flight = counts;
    }

    pub(crate) fn admission_settled(&self) {
        self.finish(Stage::Admission, Status::Drained);
    }

    pub(crate) fn runtime_settled(&self, result: Result<(), FailureKind>) {
        let status = match result {
            Ok(()) => Status::Drained,
            Err(FailureKind::TimedOut) => Status::TimedOut,
            Err(FailureKind::Failed) => Status::Failed,
        };
        self.finish(Stage::Admission, status);
        self.finish(Stage::All, status);
    }

    fn finish(&self, boundary: Stage, status: Status) {
        let mut state = self.lock();
        state.expire();
        let current = match boundary {
            Stage::Admission => &mut state.admission,
            Stage::All => &mut state.runtime,
        };
        if *current == Status::Draining {
            *current = status;
        }
        drop(state);
    }

    pub(crate) fn snapshot(&self) -> Snapshot {
        let mut state = self.lock();
        state.expire();
        Snapshot {
            consumer: String::from("momo-processing-worker"),
            scope: String::from("process"),
            mode: String::from(if state.frozen { "frozen" } else { "normal" }),
            process_id: std::process::id(),
            cutover_id: state
                .request
                .as_ref()
                .map(|request| request.cutover_id.clone()),
            stop_epoch: state.request.as_ref().map(|request| request.stop_epoch),
            stage: state.request.as_ref().map(|request| request.stage),
            phase: state.phase().to_owned(),
            writers: vec![
                writer("scheduler_and_attempts", Stage::Admission, state.admission),
                writer("runtime_and_notifications", Stage::All, state.runtime),
            ],
            in_flight: state.in_flight,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum FailureKind {
    TimedOut,
    Failed,
}

fn writer(name: &str, stage: Stage, status: Status) -> Writer {
    Writer {
        name: name.to_owned(),
        stage,
        status,
        failure: match status {
            Status::TimedOut => Some(Failure::DrainTimeout),
            Status::Failed => Some(Failure::DrainFailed),
            Status::Active | Status::Draining | Status::Drained => None,
        },
    }
}

struct Configuration {
    path: PathBuf,
    token: String,
}

impl Configuration {
    fn from_environment() -> Result<Option<Self>, &'static str> {
        let Some(token) = std::env::var_os(TOKEN_ENV) else {
            return Ok(None);
        };
        let token = token
            .into_string()
            .map_err(|_error| "invalid maintenance operations token")?;
        if !valid_token(&token) {
            return Err("invalid maintenance operations token");
        }
        let path = std::env::var_os("MOMO_MAINTENANCE_SOCKET")
            .map_or_else(|| PathBuf::from(SOCKET_PATH), PathBuf::from);
        if !path.is_absolute() {
            return Err("invalid maintenance socket path");
        }
        Ok(Some(Self { path, token }))
    }
}

fn valid_token(token: &str) -> bool {
    let unpadded = token.trim_end_matches('=');
    (32..=512).contains(&token.len())
        && !unpadded.is_empty()
        && unpadded
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~+/-".contains(&byte))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ErrorCode {
    Unauthorized,
    InvalidInput,
    CutoverConflict,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Frame {
    token: String,
    method: String,
    request: Option<Request>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    snapshot: Option<Snapshot>,
    error: Option<ErrorCode>,
}

pub(crate) struct Server {
    listener: UnixListener,
    path: PathBuf,
    token_digest: [u8; 32],
    control: Control,
}

impl Server {
    pub(crate) async fn configured(frozen: bool) -> Result<Option<Self>, &'static str> {
        let Some(configuration) = Configuration::from_environment()? else {
            return Ok(None);
        };
        Self::bind(configuration, frozen)
            .await
            .map(Some)
            .map_err(|_error| "maintenance control socket failed")
    }

    async fn bind(configuration: Configuration, frozen: bool) -> io::Result<Self> {
        remove_stale_socket(&configuration.path).await?;
        let listener = UnixListener::bind(&configuration.path)?;
        std::fs::set_permissions(&configuration.path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            path: configuration.path,
            token_digest: Sha256::digest(configuration.token.as_bytes()).into(),
            control: Control::new(frozen, DRAIN_TIMEOUT),
        })
    }

    pub(crate) fn control(&self) -> Control {
        self.control.clone()
    }

    pub(crate) async fn serve(&self) -> io::Result<()> {
        loop {
            let (stream, _) = self.listener.accept().await?;
            // Only control I/O is bounded here. Business work stays owned by the runtime.
            let _result = time::timeout(CONTROL_TIMEOUT, self.handle(stream)).await;
        }
    }

    async fn handle(&self, mut stream: UnixStream) -> io::Result<()> {
        let mut encoded = Vec::new();
        BufReader::new((&mut stream).take(MAXIMUM_FRAME + 1))
            .read_until(b'\n', &mut encoded)
            .await?;
        let reply = if u64::try_from(encoded.len()).unwrap_or(u64::MAX) > MAXIMUM_FRAME {
            Err(ErrorCode::InvalidInput)
        } else {
            serde_json::from_slice::<Frame>(&encoded)
                .map_err(|_error| ErrorCode::InvalidInput)
                .and_then(|frame| self.respond(frame))
        };
        let reply = match reply {
            Ok(snapshot) => Reply {
                snapshot: Some(snapshot),
                error: None,
            },
            Err(error) => Reply {
                snapshot: None,
                error: Some(error),
            },
        };
        let mut bytes = serde_json::to_vec(&reply).map_err(io::Error::other)?;
        bytes.push(b'\n');
        stream.write_all(&bytes).await?;
        stream.shutdown().await
    }

    fn respond(&self, frame: Frame) -> Result<Snapshot, ErrorCode> {
        let digest: [u8; 32] = Sha256::digest(frame.token.as_bytes()).into();
        if digest
            .iter()
            .zip(self.token_digest)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            != 0
        {
            return Err(ErrorCode::Unauthorized);
        }
        match (frame.method.as_str(), frame.request) {
            ("GET", None) => {}
            ("POST", Some(request)) => self.control.request(request)?,
            _ => return Err(ErrorCode::InvalidInput),
        }
        Ok(self.control.snapshot())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _result = std::fs::remove_file(&self.path);
    }
}

async fn remove_stale_socket(path: &Path) -> io::Result<()> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !metadata.file_type().is_socket() {
        return Err(io::Error::other("maintenance path is not a socket"));
    }
    match UnixStream::connect(path).await {
        Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {
            std::fs::remove_file(path)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
        Ok(_stream) => Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "maintenance socket is in use",
        )),
    }
}

pub(crate) async fn command(request: Option<Request>) -> Result<Snapshot, &'static str> {
    if request.as_ref().is_some_and(|request| !request.valid()) {
        return Err("invalid maintenance drain request");
    }
    let configuration =
        Configuration::from_environment()?.ok_or("maintenance operations token is required")?;
    time::timeout(CONTROL_TIMEOUT, send(&configuration, request))
        .await
        .map_err(|_elapsed| "maintenance control request timed out")?
}

async fn send(
    configuration: &Configuration,
    request: Option<Request>,
) -> Result<Snapshot, &'static str> {
    let mut stream = UnixStream::connect(&configuration.path)
        .await
        .map_err(|_error| "maintenance control connection failed")?;
    let frame = Frame {
        token: configuration.token.clone(),
        method: String::from(if request.is_some() { "POST" } else { "GET" }),
        request,
    };
    let mut bytes =
        serde_json::to_vec(&frame).map_err(|_error| "invalid maintenance control request")?;
    bytes.push(b'\n');
    stream
        .write_all(&bytes)
        .await
        .map_err(|_error| "maintenance control write failed")?;
    let mut encoded = Vec::new();
    BufReader::new(stream.take(MAXIMUM_FRAME + 1))
        .read_until(b'\n', &mut encoded)
        .await
        .map_err(|_error| "maintenance control read failed")?;
    if u64::try_from(encoded.len()).unwrap_or(u64::MAX) > MAXIMUM_FRAME {
        return Err("invalid maintenance control response");
    }
    let reply: Reply = serde_json::from_slice(&encoded)
        .map_err(|_error| "invalid maintenance control response")?;
    match (reply.snapshot, reply.error) {
        (Some(snapshot), None)
            if snapshot.consumer == "momo-processing-worker" && snapshot.scope == "process" =>
        {
            Ok(snapshot)
        }
        (None, Some(ErrorCode::CutoverConflict)) => Err("maintenance cutover conflict"),
        (None, Some(ErrorCode::Unauthorized)) => Err("maintenance control unauthorized"),
        _ => Err("invalid maintenance control response"),
    }
}

#[cfg(test)]
mod tests;
