//! The analysis capability owns renewal connection lifetime, including uncertain outcomes.

use tokio::time;
use tokio_postgres::Client;

use crate::postgres;

use super::{
    config::AnalysisConsumerConfig,
    control::{ClaimedJob, ControlError, HeartbeatResult, heartbeat},
};

pub(super) enum HeartbeatFailure {
    Deadline,
    Dependency(ControlError),
    ConnectionClosed,
}

pub(super) struct HeartbeatConnection {
    session: Option<Box<(Client, postgres::Driver)>>,
    summary: RenewalSummary,
}

#[derive(Default)]
struct RenewalSummary {
    count: u64,
    confirmed: u64,
    total: std::time::Duration,
    maximum: std::time::Duration,
}

struct RenewalObservation<'a> {
    summary: &'a mut RenewalSummary,
    started: std::time::Instant,
    confirmed: bool,
}

impl Drop for RenewalObservation<'_> {
    fn drop(&mut self) {
        let elapsed = self.started.elapsed();
        self.summary.count += 1;
        self.summary.confirmed += u64::from(self.confirmed);
        self.summary.total = self.summary.total.saturating_add(elapsed);
        self.summary.maximum = self.summary.maximum.max(elapsed);
    }
}

impl HeartbeatConnection {
    pub(super) async fn connect(database_url: &str) -> Result<Self, postgres::PostgresError> {
        Ok(Self {
            session: Some(Box::new(postgres::open(database_url).await?)),
            summary: RenewalSummary::default(),
        })
    }

    pub(super) fn finish_attempt(&mut self) {
        let summary = std::mem::take(&mut self.summary);
        tracing::info!(
            event = "analysis_heartbeat_summary",
            heartbeat_count = summary.count,
            heartbeat_confirmed_count = summary.confirmed,
            heartbeat_total_milliseconds = super::metrics::signed_milliseconds(summary.total),
            heartbeat_max_milliseconds = super::metrics::signed_milliseconds(summary.maximum),
            "analysis attempt renewal summary"
        );
    }

    pub(super) async fn renew(
        &mut self,
        claim: &ClaimedJob,
        config: &AnalysisConsumerConfig,
    ) -> Result<HeartbeatResult, HeartbeatFailure> {
        // The future owns both halves while I/O is in flight. Timeout, shutdown, hard deadline,
        // dependency failure, or cancellation drops the socket itself, not just a query future.
        // No detached driver can keep a timed-out transaction alive or be reused by a new attempt.
        let previous = self.session.take();
        let mut observation = RenewalObservation {
            summary: &mut self.summary,
            started: std::time::Instant::now(),
            confirmed: false,
        };
        let operation = async {
            let mut session = match previous {
                Some(session) => session,
                None => Box::new(
                    postgres::open(&config.database_url)
                        .await
                        .map_err(ControlError::from)
                        .map_err(HeartbeatFailure::Dependency)?,
                ),
            };
            let (client, driver) = session.as_mut();
            let result = tokio::select! {
                result = heartbeat(client, claim, config) =>
                    result.map_err(HeartbeatFailure::Dependency),
                _result = driver => Err(HeartbeatFailure::ConnectionClosed),
            }?;
            Ok((result, session))
        };
        let (result, session) = time::timeout(config.heartbeat_timeout, operation)
            .await
            .map_err(|_elapsed| HeartbeatFailure::Deadline)??;
        // Only a confirmed transaction result permits reuse. A lost COMMIT response remains
        // unknown even though disconnecting releases the local resource; DB fencing recovers it.
        self.session = Some(session);
        observation.confirmed = matches!(
            result,
            HeartbeatResult::Continue | HeartbeatResult::PreemptRequested
        );
        drop(observation);
        Ok(result)
    }
}
