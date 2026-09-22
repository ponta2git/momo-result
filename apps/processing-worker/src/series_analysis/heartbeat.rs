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
    session: Option<(Client, postgres::Driver)>,
}

impl HeartbeatConnection {
    pub(super) async fn connect(database_url: &str) -> Result<Self, postgres::PostgresError> {
        Ok(Self {
            session: Some(postgres::open(database_url).await?),
        })
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
        let operation = async {
            let (mut client, mut driver) = match previous {
                Some(session) => session,
                None => postgres::open(&config.database_url)
                    .await
                    .map_err(ControlError::from)
                    .map_err(HeartbeatFailure::Dependency)?,
            };
            let result = tokio::select! {
                result = heartbeat(&mut client, claim, config) =>
                    result.map_err(HeartbeatFailure::Dependency),
                _result = &mut driver => Err(HeartbeatFailure::ConnectionClosed),
            }?;
            Ok((result, (client, driver)))
        };
        let (result, session) = time::timeout(config.heartbeat_timeout, operation)
            .await
            .map_err(|_elapsed| HeartbeatFailure::Deadline)??;
        // Only a confirmed transaction result permits reuse. A lost COMMIT response remains
        // unknown even though disconnecting releases the local resource; DB fencing recovers it.
        self.session = Some(session);
        Ok(result)
    }
}
