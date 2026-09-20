use std::{error::Error, time::Duration};

use super::refresh;

#[tokio::test]
#[ignore = "requires explicitly isolated ANALYSIS_CONTROL_SMOKE_DATABASE_URL"]
#[expect(
    clippy::panic_in_result_fn,
    reason = "the regression asserts committed projections after synchronizing on a database lock"
)]
async fn real_postgres_campaign_refresh_counts_concurrent_target_commits()
-> Result<(), Box<dyn Error + Send + Sync>> {
    let database_url = std::env::var("ANALYSIS_CONTROL_SMOKE_DATABASE_URL")?;
    let mut first = crate::postgres::connect(&database_url).await?;
    let mut second = crate::postgres::connect(&database_url).await?;
    let observer = crate::postgres::connect(&database_url).await?;
    let campaign_ids = ["analysis-campaign-concurrency".to_owned()];
    observer.batch_execute(include_str!("seed.sql")).await?;
    let second_pid: i32 = second
        .query_one("SELECT pg_backend_pid()", &[])
        .await?
        .try_get(0)?;
    let first_transaction = first.transaction().await?;
    let second_transaction = second.transaction().await?;
    for transaction in [&first_transaction, &second_transaction] {
        transaction
            .batch_execute("SET LOCAL statement_timeout = '5s'")
            .await?;
        // Inserting a request also takes a KEY SHARE lock through its campaign foreign key.
        transaction
            .query_one(
                "SELECT id FROM series_analysis_campaigns WHERE id = $1 FOR KEY SHARE",
                &[&campaign_ids[0]],
            )
            .await?;
    }
    first_transaction
        .execute(
            "UPDATE series_analysis_campaign_targets SET status = 'succeeded'
         WHERE campaign_id = $1 AND game_title_id = 'concurrent-title-a'",
            &[&campaign_ids[0]],
        )
        .await?;
    second_transaction
        .execute(
            "UPDATE series_analysis_campaign_targets SET status = 'failed'
         WHERE campaign_id = $1 AND game_title_id = 'concurrent-title-b'",
            &[&campaign_ids[0]],
        )
        .await?;
    refresh(&first_transaction, &campaign_ids).await?;
    let second_refresh = async {
        refresh(&second_transaction, &campaign_ids).await?;
        second_transaction.commit().await
    };
    tokio::pin!(second_refresh);
    let blocked = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let row = observer
                .query_one(
                    "SELECT cardinality(pg_blocking_pids($1)) > 0",
                    &[&second_pid],
                )
                .await?;
            if row.try_get::<_, bool>(0)? {
                return Ok::<(), tokio_postgres::Error>(());
            }
            tokio::task::yield_now().await;
        }
    });
    tokio::select! {
        result = &mut second_refresh => {
            result?;
            return Err("campaign refresh did not serialize concurrent target commits".into());
        }
        result = blocked => { result??; }
    }
    first_transaction.commit().await?;
    second_refresh.await?;
    let row = observer
        .query_one(
            "SELECT c.status, c.expanded_count, c.terminal_count, c.failed_count, o.status
         FROM series_analysis_campaigns c
         JOIN series_analysis_operation_requests o ON o.id = c.operation_request_id
         WHERE c.id = $1",
            &[&campaign_ids[0]],
        )
        .await?;
    assert_eq!(row.try_get::<_, String>(0)?, "terminal");
    assert_eq!(row.try_get::<_, i32>(1)?, 2);
    assert_eq!(row.try_get::<_, i32>(2)?, 2);
    assert_eq!(row.try_get::<_, i32>(3)?, 1);
    assert_eq!(row.try_get::<_, String>(4)?, "terminal");
    observer
        .execute(
            "DELETE FROM series_analysis_operation_requests WHERE id = $1",
            &[&campaign_ids[0]],
        )
        .await?;
    Ok(())
}
