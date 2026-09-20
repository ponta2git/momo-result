use tokio_postgres::{GenericClient, types::Type};

use super::AnalysisSource;

/// Requests, rather than the first job trigger, describe the work this attempt completed.
/// The producer chooses the eligible request kind; storage only answers whether it exists.
pub(super) async fn has_match_mutation(
    client: &(impl GenericClient + Sync),
    source: AnalysisSource<'_>,
    status: &str,
) -> Result<bool, tokio_postgres::Error> {
    client
        .query_typed_one(
            "SELECT EXISTS (SELECT 1 FROM series_analysis_job_requests \
             WHERE assigned_attempt_id = $1 AND assigned_job_id = $2 AND game_title_id = $3 \
               AND input_revision <= $4 AND status = $5 AND trigger = $6)",
            &[
                (&source.attempt_id, Type::TEXT),
                (&source.job_id, Type::TEXT),
                (&source.game_title_id, Type::TEXT),
                (&source.input_revision, Type::INT8),
                (&status, Type::TEXT),
                (&"match_mutation", Type::TEXT),
            ],
        )
        .await?
        .try_get(0)
}
