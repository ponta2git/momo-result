//! A lost finalization reply must not retain the worker's execution slot indefinitely.

use std::sync::Arc;

use tokio::{sync::Notify, time};

use super::{
    Client, Duration, SmokeResult, TAKEOVER, claimed, control_config, insert_fixture,
    prepare_database,
};
use crate::{
    ocr::control::{
        OcrControlError, OcrFailureCode, claim_job, finish_failure, requeue_interrupted,
    },
    postgres::test_support::{CommitFault, DelayedDatabase},
};

pub(super) async fn verify(database_url: &str, observer: &mut Client) -> SmokeResult {
    for (terminal, expected_status) in [(true, "failed"), (false, "queued")] {
        prepare_database(observer).await?;
        insert_fixture(observer, &TAKEOVER).await?;
        let config = control_config("ocr-c2-finalization")?;
        let claim = claimed(claim_job(observer, TAKEOVER.job_id, &config).await?)?;
        let committed = Arc::new(Notify::new());
        let proxy = DelayedDatabase::commit_fault(
            database_url,
            CommitFault::HoldReply {
                committed: Arc::clone(&committed),
                release: Arc::new(Notify::new()),
            },
        )
        .await?;
        let mut uncertain = crate::identity::fixtures::connect(&proxy.url).await?;
        let transition = async {
            if terminal {
                finish_failure(
                    &mut uncertain,
                    &claim,
                    &config,
                    OcrFailureCode::ParserFailed,
                    0,
                )
                .await
            } else {
                requeue_interrupted(&mut uncertain, &claim, &config).await
            }
        };
        let (result, ()) = time::timeout(
            config.finalization_timeout() + Duration::from_secs(2),
            async { tokio::join!(transition, committed.notified()) },
        )
        .await?;
        assert!(
            matches!(result, Err(OcrControlError::FinalizationTimeout)),
            "an unacknowledged finalization must report uncertainty within its deadline"
        );
        drop(uncertain);
        let state = observer
            .query_one(
                "SELECT status, lease_owner IS NULL, failure_retry_count \
                 FROM ocr_jobs WHERE legacy_id = $1",
                &[&TAKEOVER.job_id],
            )
            .await?;
        assert_eq!(state.try_get::<_, String>(0)?, expected_status);
        assert!(state.try_get::<_, bool>(1)?);
        assert_eq!(state.try_get::<_, i32>(2)?, 0);
    }
    Ok(())
}
