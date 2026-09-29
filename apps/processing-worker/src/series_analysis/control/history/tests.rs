use std::{error::Error, time::SystemTime};

use super::cleanup_history;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "the retention contract asserts persisted state while setup errors stay visible"
)]
async fn real_postgres_retention_preserves_active_jobs_and_readable_artifacts()
-> Result<(), Box<dyn Error + Send + Sync>> {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut primary = crate::postgres::connect(&database_url).await?;
    let mut secondary = crate::postgres::connect(&database_url).await?;
    primary.batch_execute(include_str!("seed.sql")).await?;
    let now: SystemTime = primary
        .query_one("SELECT '2099-08-09T12:00:00Z'::timestamptz", &[])
        .await?
        .try_get(0)?;

    assert_eq!(
        cleanup_history(&mut primary, now, 1).await?,
        [0, 0, 1, 1, 1]
    );
    assert_radar_retention(&primary).await?;
    let remaining = primary
        .query(
            "SELECT id FROM series_analysis_jobs WHERE game_title_id = $1 ORDER BY id",
            &[&"analysis-history-test-title"],
        )
        .await?
        .into_iter()
        .map(|row| row.try_get::<_, String>(0))
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(
        remaining,
        [
            "analysis-history-test-active",
            "analysis-history-test-fresh",
            "analysis-history-test-old-b"
        ]
    );
    let artifact_counts: (i64, i64) = {
        let row = primary
            .query_one(
                "SELECT (SELECT COUNT(*) FROM series_analysis_artifacts WHERE game_title_id = $1),
                        (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts
                         WHERE artifact_id LIKE 'analysis-history-test-%')",
                &[&"analysis-history-test-title"],
            )
            .await?;
        (row.try_get(0)?, row.try_get(1)?)
    };
    assert_eq!(artifact_counts, (3, 3));

    let held = secondary.transaction().await?;
    held.query_one(
        "SELECT id FROM series_analysis_jobs WHERE id = 'analysis-history-test-old-b' FOR UPDATE",
        &[],
    )
    .await?;
    assert_eq!(cleanup_history(&mut primary, now, 1).await?, [0; 5]);
    held.rollback().await?;
    assert_eq!(
        cleanup_history(&mut primary, now, 1).await?,
        [0, 0, 1, 0, 0]
    );
    primary
        .execute(
            "UPDATE series_analysis_title_states \
             SET notification_baseline_artifact_id = current_artifact_id \
             WHERE game_title_id = 'analysis-history-test-title'",
            &[],
        )
        .await?;
    assert_eq!(
        cleanup_history(&mut primary, now, 1).await?,
        [0, 0, 0, 0, 1],
        "advancing the baseline makes its old, expired artifact collectible"
    );
    primary
        .execute(
            "DELETE FROM game_titles WHERE id = 'analysis-history-test-title'",
            &[],
        )
        .await?;
    Ok(())
}

async fn assert_radar_retention(
    client: &tokio_postgres::Client,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let bases = client
        .query(
            "SELECT id, source_snapshot IS NOT NULL FROM series_radar_bases \
             WHERE game_title_id = 'analysis-history-test-title' ORDER BY id",
            &[],
        )
        .await?
        .into_iter()
        .map(|row| Ok((row.try_get::<_, String>(0)?, row.try_get::<_, bool>(1)?)))
        .collect::<Result<Vec<_>, tokio_postgres::Error>>()?;
    assert_eq!(
        bases,
        [
            ("analysis-history-radar-current".to_owned(), true),
            ("analysis-history-radar-obsolete".to_owned(), false),
        ]
    );
    let previews = client
        .query(
            "SELECT p.id, p.status, p.evaluation_snapshot IS NOT NULL, \
                    cardinality(p.scope_keys), count(s.scope_key) \
             FROM series_radar_previews p LEFT JOIN series_radar_preview_scopes s ON s.preview_id=p.id \
             WHERE p.game_title_id = 'analysis-history-test-title' GROUP BY p.id ORDER BY p.id",
            &[],
        )
        .await?
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<_, String>(0)?,
                row.try_get::<_, String>(1)?,
                row.try_get::<_, bool>(2)?,
                row.try_get::<_, i32>(3)?,
                row.try_get::<_, i64>(4)?,
            ))
        })
        .collect::<Result<Vec<_>, tokio_postgres::Error>>()?;
    assert_eq!(
        previews,
        [
            (
                "analysis-history-radar-preview-latest".to_owned(),
                "ready".to_owned(),
                true,
                1,
                1
            ),
            (
                "analysis-history-radar-preview-old".to_owned(),
                "stale".to_owned(),
                false,
                0,
                0
            ),
        ]
    );
    Ok(())
}
