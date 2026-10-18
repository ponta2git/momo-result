//! Frozen initialization and continuation are separately digest-bound operations.
use std::time::Duration;

use clap::{Args, ValueEnum};
use serde::Serialize;
use thiserror::Error;
use tokio::{sync::watch, time};

use crate::{
    postgres,
    series_analysis::config::{AnalysisActivationConfig, AnalysisConsumerConfig},
};

use super::drain;

pub(crate) mod scope;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum Phase {
    Initialize,
    Continue,
}

#[derive(Args, Debug)]
pub(crate) struct Arguments {
    #[arg(long, value_enum, default_value = "continue")]
    pub(crate) phase: Phase,
    #[arg(long)]
    pub(crate) cutover_id: String,
    #[arg(long)]
    pub(crate) stop_epoch: u64,
    #[arg(long)]
    pub(crate) operation_id: String,
    #[arg(long)]
    pub(crate) campaign_id: String,
    #[arg(long)]
    pub(crate) apply: bool,
    #[arg(long)]
    pub(crate) expected_plan: Option<String>,
    #[arg(long)]
    pub(crate) candidate_release: Option<String>,
    #[arg(long)]
    pub(crate) readiness_digest: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    pub(crate) cutover_id: String,
    pub(crate) stop_epoch: u64,
    pub(crate) operation_id: String,
    pub(crate) campaign_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub(crate) schema_version: u8,
    pub(crate) kind: &'static str,
    #[serde(flatten)]
    pub(crate) request: Request,
    pub(crate) plan_digest: String,
    pub(crate) status: &'static str,
    pub(crate) target_count: u64,
    pub(crate) completed_count: u64,
    pub(crate) failed_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) candidate_release: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) readiness_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) continuation_plan_digest: Option<String>,
    #[serde(skip)]
    pub(crate) next_pending_title: Option<String>,
    #[serde(skip)]
    pub(crate) next_job: Option<String>,
}

#[derive(Debug, Error)]
pub(crate) enum ScopeError {
    #[error("invalid scoped analysis request")]
    InvalidRequest,
    #[error("scoped analysis requires the matching live frozen barrier")]
    Barrier,
    #[error("scoped analysis database inspection failed")]
    Database(#[from] tokio_postgres::Error),
    #[error("scoped analysis database connection failed")]
    Connection(#[from] postgres::PostgresError),
    #[error("scoped analysis operation or campaign does not match the current release")]
    Scope,
    #[error("scoped analysis plan changed or requires attention")]
    Plan,
    #[error("another scoped analysis operation is active")]
    Busy,
    #[error("scoped analysis configuration is invalid")]
    Configuration,
    #[error("scoped analysis connection cleanup did not settle")]
    Cleanup,
    #[error("scoped analysis release validation failed")]
    Release(#[from] crate::series_analysis::release::ReleaseError),
}

#[derive(Clone)]
pub(crate) struct BoundScope {
    pub(crate) request: Request,
    pub(crate) plan_digest: String,
    pub(crate) process_id: u32,
}

impl BoundScope {
    pub(crate) async fn live_barrier(&self) -> Result<(), ScopeError> {
        let current = frozen_process(&self.request).await?;
        if current != self.process_id {
            return Err(ScopeError::Barrier);
        }
        Ok(())
    }

    pub(crate) async fn inspect(
        &self,
        client: &mut tokio_postgres::Client,
    ) -> Result<Report, ScopeError> {
        self.live_barrier().await?;
        let report = scope::inspect(client, &self.request).await?;
        self.accept(&report)?;
        Ok(report)
    }

    pub(crate) fn accept(&self, report: &Report) -> Result<(), ScopeError> {
        if report.plan_digest != self.plan_digest || report.status == "attention_required" {
            return Err(ScopeError::Plan);
        }
        Ok(())
    }
}

pub(crate) async fn prepare(
    arguments: &Arguments,
) -> Result<(BoundScope, Report, postgres::ConnectedClient), ScopeError> {
    let request = Request {
        cutover_id: arguments.cutover_id.clone(),
        stop_epoch: arguments.stop_epoch,
        operation_id: arguments.operation_id.clone(),
        campaign_id: arguments.campaign_id.clone(),
    };
    if arguments.phase != Phase::Continue
        || arguments.candidate_release.is_some()
        || arguments.readiness_digest.is_some()
        || !valid_request(&request)
        || (arguments.apply != arguments.expected_plan.is_some())
    {
        return Err(ScopeError::InvalidRequest);
    }
    let process_id = frozen_process(&request).await?;
    let database_url = std::env::var("DATABASE_URL").map_err(|_error| ScopeError::Configuration)?;
    let mut client = postgres::connect(&database_url).await?;
    let report = scope::inspect(&mut client, &request).await?;
    let bound = BoundScope {
        request,
        plan_digest: report.plan_digest.clone(),
        process_id,
    };
    if arguments.apply {
        if arguments.expected_plan.as_deref() != Some(report.plan_digest.as_str()) {
            return Err(ScopeError::Plan);
        }
        bound.accept(&report)?;
        // Session ownership lasts through all scoped writes and finalization, including failure.
        let locked: bool = client
            .query_one("SELECT pg_try_advisory_lock(1297042767, 1095649612)", &[])
            .await?
            .try_get(0)?;
        if !locked {
            return Err(ScopeError::Busy);
        }
        bound.inspect(&mut client).await?;
    }
    Ok((bound, report, client))
}

/// The privileged bootstrap may join only the matching live daemon's existing child boundary.
pub(crate) async fn bootstrap_process(arguments: &Arguments) -> Result<u32, ScopeError> {
    let request = Request {
        cutover_id: arguments.cutover_id.clone(),
        stop_epoch: arguments.stop_epoch,
        operation_id: arguments.operation_id.clone(),
        campaign_id: arguments.campaign_id.clone(),
    };
    if !arguments.apply || arguments.expected_plan.is_none() || !valid_request(&request) {
        return Err(ScopeError::InvalidRequest);
    }
    frozen_process(&request).await
}

pub(crate) fn configuration(request: &Request) -> Result<AnalysisConsumerConfig, ScopeError> {
    let activation =
        AnalysisActivationConfig::from_environment().map_err(|_error| ScopeError::Configuration)?;
    let mut config = AnalysisConsumerConfig::from_environment(&activation)
        .map_err(|_error| ScopeError::Configuration)?;
    // Scoped work never refreshes or drains an ordinary daemon's capability row.
    config.worker_id = format!("maintenance-{}-{}", request.cutover_id, std::process::id());
    Ok(config)
}

pub(crate) async fn settled() -> Result<(), ScopeError> {
    if postgres::settle_drivers(time::Instant::now() + Duration::from_secs(5)).await {
        Ok(())
    } else {
        Err(ScopeError::Cleanup)
    }
}

pub(crate) async fn frozen_process(request: &Request) -> Result<u32, ScopeError> {
    drain::command(None)
        .await
        .map_err(|_error| ScopeError::Barrier)?
        .frozen_process(&request.cutover_id, request.stop_epoch)
        .ok_or(ScopeError::Barrier)
}

pub(crate) fn valid_request(request: &Request) -> bool {
    identifier(&request.cutover_id, 64)
        && identifier(&request.operation_id, 128)
        && identifier(&request.campaign_id, 128)
        && request.stop_epoch > 0
        && request.stop_epoch <= 9_007_199_254_740_991
}

fn identifier(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub(crate) async fn execute(
    arguments: Arguments,
    shutdown: watch::Receiver<bool>,
    shutdown_deadline: &mut Option<time::Instant>,
) -> Result<Report, String> {
    if arguments.phase == Phase::Initialize {
        let result = crate::series_analysis::release::initialize_frozen(&arguments).await;
        settled().await.map_err(|error| error.to_string())?;
        return result.map_err(|error| error.to_string());
    }
    let (bound, report, client) = prepare(&arguments)
        .await
        .map_err(|error| error.to_string())?;
    if !arguments.apply || report.status == "complete" {
        drop(client);
        settled().await.map_err(|error| error.to_string())?;
        return Ok(report);
    }
    let result = {
        let config = configuration(&bound.request).map_err(|error| error.to_string())?;
        Box::pin(crate::worker::run_maintenance_analysis(
            config,
            bound.clone(),
            client,
            shutdown,
            shutdown_deadline,
        ))
        .await
    };
    settled().await.map_err(|error| error.to_string())?;
    result.map_err(|_error| {
        String::from("scoped analysis execution failed; inspect the operation before retrying")
    })?;
    let (finished_scope, finished_report, inspector) = prepare(&Arguments {
        apply: false,
        expected_plan: None,
        ..arguments
    })
    .await
    .map_err(|error| error.to_string())?;
    drop(inspector);
    settled().await.map_err(|error| error.to_string())?;
    if finished_scope.process_id != bound.process_id {
        return Err(ScopeError::Barrier.to_string());
    }
    if finished_report.plan_digest != bound.plan_digest {
        return Err(ScopeError::Plan.to_string());
    }
    Ok(finished_report)
}
