//! The release operator challenges the resident worker on loopback. No timer or
//! DB connection is held by the challenge listener while the machine is idle.
use std::{
    io,
    net::Ipv4Addr,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::timeout,
};
use tokio_postgres::Client;

use super::{
    ConsumerError,
    control::{admit_capability, capability_row_id},
};
use crate::{
    postgres,
    worker::{PostCommitEffects, PostCommitSink, wake_http},
};

const PORT: u16 = 19372;
const CHALLENGE: &[u8] = b"momo-release-attest-v1\n";
const ACTIVE_CHALLENGE: &[u8] = b"momo-release-active-v1\n";

pub(super) struct Admission {
    admitted: Arc<AtomicBool>,
    listener: Option<JoinHandle<()>>,
}

impl Admission {
    pub(super) async fn start(
        client: &mut Client,
        database_url: &str,
        worker_id: &str,
        wake: PostCommitSink,
    ) -> Result<Self, ConsumerError> {
        let server = if std::env::var_os("FLY_MACHINE_ID").is_some()
            || std::env::var("MOMO_ANALYSIS_RELEASE_ATTESTATION").as_deref() == Ok("enabled")
        {
            Some(TcpListener::bind((Ipv4Addr::LOCALHOST, PORT)).await?)
        } else {
            None
        };
        let admitted = Arc::new(AtomicBool::new(admit_capability(client, worker_id).await?));
        let listener = server.map(|server| {
            let state = Arc::clone(&admitted);
            let url = database_url.to_owned();
            let worker = worker_id.to_owned();
            tokio::spawn(async move {
                while let Ok((mut stream, _peer)) = server.accept().await {
                    // One short, bounded command at a time. A failed challenge emits no proof.
                    let _completed = timeout(Duration::from_secs(12), async {
                        let mut request = [0; CHALLENGE.len()];
                        stream.read_exact(&mut request).await?;
                        let require_active = request == ACTIVE_CHALLENGE;
                        if request == CHALLENGE || require_active {
                            let registration = async {
                                let mut db =
                                    postgres::connect(&url).await.map_err(io::Error::other)?;
                                admit_capability(&mut db, &worker)
                                    .await
                                    .map_err(io::Error::other)
                            };
                            let transport = async {
                                if require_active {
                                    wake_http::verify_writers()
                                        .await
                                        .map_err(io::Error::other)?;
                                }
                                io::Result::Ok(())
                            };
                            let (current, transport) = tokio::join!(registration, transport);
                            let current = current?;
                            let previous = state.swap(current, Ordering::AcqRel);
                            if !current && require_active {
                                return Ok(());
                            }
                            if current && !previous {
                                wake.submit(PostCommitEffects::WakeJobs)
                                    .map_err(io::Error::other)?;
                            }
                            transport?;
                            stream
                                .write_all(capability_row_id(&worker).as_bytes())
                                .await?;
                            stream.write_all(b"\n").await?;
                        }
                        io::Result::Ok(())
                    })
                    .await;
                }
            })
        });
        Ok(Self { admitted, listener })
    }

    pub(super) async fn stop(&mut self) {
        if let Some(listener) = self.listener.take() {
            listener.abort();
            let _stopped = listener.await;
        }
        self.admitted.store(false, Ordering::Release);
    }

    pub(super) fn admitted(&self) -> bool {
        self.admitted.load(Ordering::Acquire)
    }
}

impl Drop for Admission {
    fn drop(&mut self) {
        if let Some(listener) = &self.listener {
            listener.abort();
        }
    }
}

pub(crate) async fn challenge(require_active: bool) -> io::Result<String> {
    timeout(Duration::from_secs(15), async {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, PORT)).await?;
        stream
            .write_all(if require_active {
                ACTIVE_CHALLENGE
            } else {
                CHALLENGE
            })
            .await?;
        let mut response = String::new();
        stream.take(256).read_to_string(&mut response).await?;
        let id = response
            .strip_suffix('\n')
            .filter(|s| {
                !s.is_empty()
                    && s.len() < 255
                    && s.bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_.@".contains(&byte))
            })
            .ok_or_else(|| io::Error::other("invalid worker attestation"))?;
        Ok(id.to_owned())
    })
    .await?
}
