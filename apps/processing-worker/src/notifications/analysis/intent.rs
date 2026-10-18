use tokio_postgres::{Client, types::Type};

use super::AnalysisSource;

/// An assigned match-mutation request makes this attempt eligible for comparison.
/// The publication snapshot separately checks that the request was fulfilled.
pub(super) async fn has_assigned_match_mutation(
    client: &Client,
    source: AnalysisSource<'_>,
) -> Result<bool, tokio_postgres::Error> {
    client
        .query_typed_one(
            "SELECT EXISTS (SELECT 1 FROM series_analysis_job_requests \
             WHERE legacy_assigned_attempt_id = $1 AND assigned_job_id = (SELECT id FROM series_analysis_jobs WHERE legacy_id=$2) AND game_title_id = (SELECT id FROM game_titles WHERE legacy_id=$3) \
               AND input_revision <= $4 AND status = 'assigned' AND trigger = 'match_mutation')",
            &[
                (&source.attempt_id, Type::TEXT),
                (&source.job_id, Type::TEXT),
                (&source.game_title_id, Type::TEXT),
                (&source.input_revision, Type::INT8),
            ],
        )
        .await?
        .try_get(0)
}
