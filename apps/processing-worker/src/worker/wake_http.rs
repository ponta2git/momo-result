//! Each writer owns its own boot ID and cursor. Contact the admitted writers individually:
//! a load-balanced response cannot cover work accepted by a different process.

use std::{collections::BTreeSet, env, time::Duration};

use futures_util::future::try_join_all;
use reqwest::{Client, Method, header::HeaderValue, redirect::Policy};
use serde::Deserialize;
use thiserror::Error;
use tokio::{
    sync::watch,
    time::{self, Instant},
};
use url::Url;

use super::{PostCommitEffects, PostCommitSink, WorkerError};

// Writers bound a database transaction to 120s. Keep scanning until a scan *starts* after
// that window, including when an old process lost its COMMIT response just before restart.
const SETTLE: Duration = Duration::from_secs(150);
const MAX_RESPONSE: usize = 512;

#[derive(Debug, Error)]
#[error("private worker wake channel unavailable")]
pub(crate) struct WakeHttpError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ScanTicket {
    generation: u64,
    started: Instant,
}

struct Coverage {
    writers: usize,
    connected: usize,
    generation: u64,
    handled: Option<u64>,
    settle_after: Instant,
}

#[derive(Clone)]
pub(crate) struct WakeMonitor(watch::Sender<Coverage>);

impl WakeMonitor {
    pub(crate) fn new() -> Self {
        Self(
            watch::channel(Coverage {
                writers: 0,
                connected: 0,
                generation: 0,
                handled: None,
                settle_after: Instant::now() + SETTLE,
            })
            .0,
        )
    }

    pub(crate) fn scan_ticket(&self) -> ScanTicket {
        ScanTicket {
            generation: self.0.borrow().generation,
            started: Instant::now(),
        }
    }

    pub(crate) fn scanned(&self, ticket: ScanTicket) {
        self.0.send_modify(|state| {
            let settled = ticket.started >= state.settle_after;
            if settled && state.generation == ticket.generation {
                state.handled = Some(ticket.generation);
            }
        });
    }

    pub(crate) fn healthy(&self) -> bool {
        let state = self.0.borrow();
        state.writers > 0
            && state.connected == state.writers
            && state.handled == Some(state.generation)
    }

    fn change(&self, connection: Option<bool>, uncertain: bool) {
        self.0.send_modify(|state| {
            if let Some(connected) = connection {
                if connected {
                    state.connected += 1;
                } else {
                    state.connected -= 1;
                }
            }
            state.generation = state.generation.wrapping_add(1);
            state.handled = None;
            if uncertain {
                state.settle_after = Instant::now() + SETTLE;
            }
        });
    }
}

struct Peers {
    client: Client,
    token: HeaderValue,
    urls: Vec<Url>,
}

fn writer_urls(hosts: &str) -> Result<Vec<Url>, WakeHttpError> {
    let mut distinct = BTreeSet::new();
    let urls: Vec<_> = hosts
        .split(',')
        .map(|host| {
            if host.is_empty()
                || !host
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || b".:-[]".contains(&ch))
            {
                return Err(WakeHttpError);
            }
            let mut url = Url::parse(&format!("http://{host}/internal/worker/wake"))
                .map_err(|_error| WakeHttpError)?;
            if host
                .rsplit_once(':')
                .is_none_or(|(_, suffix)| suffix.parse::<u16>().is_err())
            {
                url.set_port(Some(9091)).map_err(|()| WakeHttpError)?;
            }
            if !distinct.insert(url.as_str().to_owned()) {
                return Err(WakeHttpError);
            }
            Ok(url)
        })
        .collect::<Result<_, _>>()?;
    if urls.len() > 32 {
        return Err(WakeHttpError);
    }
    Ok(urls)
}

impl Peers {
    fn configured() -> Result<Option<Self>, WakeHttpError> {
        let hosts = env::var("WORKER_WAKE_HOSTS").ok();
        let Some(token) = env::var("WORKER_WAKE_TOKEN").ok() else {
            return if hosts.is_none() && env::var_os("FLY_MACHINE_ID").is_none() {
                Ok(None)
            } else {
                Err(WakeHttpError)
            };
        };
        if token.len() < 32 || token.bytes().any(|byte| !byte.is_ascii_graphic()) {
            return Err(WakeHttpError);
        }
        let hosts = match hosts {
            Some(value) => value,
            None if env::var_os("FLY_MACHINE_ID").is_none() => "127.0.0.1:9091".to_owned(),
            None => return Err(WakeHttpError),
        };
        let mut auth =
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_error| WakeHttpError)?;
        auth.set_sensitive(true);
        Ok(Some(Self {
            client: Client::builder()
                .no_proxy()
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(4))
                .timeout(Duration::from_secs(35))
                .build()
                .map_err(|_error| WakeHttpError)?,
            token: auth,
            urls: writer_urls(&hosts)?,
        }))
    }

    fn request(&self, method: Method, url: &Url) -> reqwest::RequestBuilder {
        self.client
            .request(method, url.clone())
            .header(reqwest::header::AUTHORIZATION, self.token.clone())
    }

    async fn poll(&self, url: &Url, previous: Option<&Cursor>) -> Result<Cursor, WakeHttpError> {
        let mut url = url.clone();
        if let Some(cursor) = previous {
            url.query_pairs_mut()
                .append_pair("boot", &cursor.boot.to_string())
                .append_pair("cursor", &cursor.cursor.to_string());
        }
        Self::cursor_response(self.request(Method::GET, &url)).await
    }

    async fn cursor_response(request: reqwest::RequestBuilder) -> Result<Cursor, WakeHttpError> {
        let mut response = request.send().await.map_err(|_error| WakeHttpError)?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(WakeHttpError);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_error| WakeHttpError)? {
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE {
                return Err(WakeHttpError);
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_error| WakeHttpError)
    }

    async fn follow(
        &self,
        url: &Url,
        monitor: &WakeMonitor,
        sink: &PostCommitSink,
    ) -> Result<(), WorkerError> {
        let mut last: Option<Cursor> = None;
        let mut delay = Duration::from_secs(1);
        loop {
            if let Ok(next) = self.poll(url, last.as_ref()).await {
                let previous = last.replace(next);
                if last != previous {
                    let new_connection = previous.is_none().then_some(true);
                    let changed_boot = last.as_ref().map(|c| c.boot) != previous.map(|c| c.boot);
                    monitor.change(new_connection, changed_boot);
                    if new_connection.is_some() {
                        let coverage = monitor.0.borrow();
                        if coverage.connected == coverage.writers {
                            tracing::info!(
                                event = "processing_worker_wake_connected",
                                worker_id = env::var("MOMO_ANALYSIS_WORKER_ID").unwrap_or_default(),
                                "Connected to every admitted writer"
                            );
                        }
                    }
                    sink.submit(PostCommitEffects::WakeJobs)?;
                }
                delay = Duration::from_secs(1);
            } else {
                if last.take().is_some() {
                    monitor.change(Some(false), true);
                    sink.submit(PostCommitEffects::WakeJobs)?;
                }
                time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(15));
            }
        }
    }
}

#[derive(Deserialize, Eq, PartialEq)]
struct Cursor {
    boot: uuid::Uuid,
    cursor: u64,
}

pub(crate) async fn run(
    monitor: WakeMonitor,
    sink: PostCommitSink,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), WorkerError> {
    let peers = Peers::configured().map_err(|WakeHttpError| WorkerError::WakeTransport)?;
    tokio::select! {
        biased;
        _stopped = shutdown.wait_for(|stopped| *stopped) => Ok(()),
        result = async {
            let Some(peers) = peers else { return std::future::pending().await; };
            monitor.0.send_modify(|state| state.writers = peers.urls.len());
            try_join_all(peers.urls.iter().map(|url| peers.follow(url, &monitor, &sink))).await.map(|_| ())
        } => result
    }
}

async fn nudge(uncertain: bool) -> Result<(), WakeHttpError> {
    let Some(peers) = Peers::configured()? else {
        return Ok(());
    };
    // All peers are watched. One successfully acknowledged hint covers this external writer.
    let attempts = peers.urls.iter().map(|url| {
        let mut url = url.clone();
        if uncertain {
            url.set_query(Some("uncertain=true"));
        }
        Peers::cursor_response(
            peers
                .request(Method::POST, &url)
                .timeout(Duration::from_secs(5)),
        )
    });
    let results = futures_util::future::join_all(attempts).await;
    if results
        .into_iter()
        .flatten()
        .any(|cursor| !uncertain || cursor.cursor == 0)
    {
        Ok(())
    } else {
        Err(WakeHttpError)
    }
}

/// Announce a bounded external transaction before committing so loss of the CLI process or its
/// final acknowledgement still prompts a scan after the transaction has settled.
pub(crate) async fn begin_external_write() -> Result<(), WakeHttpError> {
    nudge(true).await
}

pub(crate) async fn notify_api() -> Result<(), WakeHttpError> {
    nudge(false).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_only_the_complete_current_writer_generation() {
        let monitor = WakeMonitor::new();
        monitor.0.send_modify(|state| {
            state.writers = 2;
            state.settle_after = Instant::now();
        });
        monitor.change(Some(true), false);
        monitor.scanned(monitor.scan_ticket());
        assert!(!monitor.healthy(), "the second writer has not connected");
        monitor.change(Some(true), false);
        let in_flight = monitor.scan_ticket();
        monitor.change(None, false);
        monitor.scanned(in_flight);
        assert!(
            !monitor.healthy(),
            "a commit during the scan still needs handling"
        );
        monitor.scanned(monitor.scan_ticket());
        assert!(
            monitor.healthy(),
            "both writers and the latest commit are covered"
        );
        monitor.change(Some(false), true);
        monitor.change(Some(true), true);
        monitor.scanned(monitor.scan_ticket());
        assert!(!monitor.healthy(), "an old transaction may still settle");
    }

    #[test]
    fn writer_list_rejects_paths_credentials_and_duplicates() {
        assert!(
            writer_urls("node1,node2:9092").is_ok(),
            "two independent writers are valid"
        );
        for hosts in [
            "",
            "a,",
            "a,a:9091",
            "user@host",
            "host/path",
            "a?secret",
            "http://host",
        ] {
            assert!(writer_urls(hosts).is_err(), "invalid private host roster");
        }
    }
}
