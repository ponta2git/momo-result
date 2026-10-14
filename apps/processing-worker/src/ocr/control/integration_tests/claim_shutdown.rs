//! A graceful stop must not discard a claim whose durable COMMIT reply is still in flight.

use std::sync::Arc;

use tokio::{
    sync::{Notify, watch},
    time,
};

use super::{
    Client, Duration, SmokeResult, TAKEOVER, insert_fixture, persisted_payload, prepare_database,
};
use crate::{
    notifications::test_support::{CommitFault, DelayedDatabase},
    ocr::{
        consumer::{
            self, OcrChildHandle, OcrChildLauncher, OcrConsumerConfig, OcrConsumerError,
            OcrConsumerTiming,
        },
        contract::{OcrHints, RequestedScreenType},
        control::OcrControlConfig,
        object_store::{R2ObjectStoreConfig, VerifiedSourceImage},
        queue::OcrQueueConfig,
    },
    outbox::PostCommitSink,
};

pub(super) async fn verify(database_url: &str, redis_url: &str, observer: &Client) -> SmokeResult {
    use redis::{AsyncCommands, streams::StreamPendingReply};

    insert_fixture(observer, &TAKEOVER).await?;
    let committed = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let proxy = DelayedDatabase::commit_fault(
        database_url,
        CommitFault::HoldReply {
            committed: Arc::clone(&committed),
            release: Arc::clone(&release),
        },
    )
    .await?;
    let stream = format!("momo:ocr-claim-shutdown:{}", std::process::id());
    let group = "ocr-claim-shutdown";
    let config = consumer_config(&proxy.url, redis_url, &stream, group)?;
    let redis_client = redis::Client::open(redis_url)?;
    let mut redis = crate::stream_connection::connect(&redis_client).await?;
    let _: usize = redis.del(&stream).await?;
    let append = append_fixture(&stream)?;
    let _message_id: String = append.query_async(&mut redis).await?;
    let (sink, _wake) = PostCommitSink::channel();
    let (shutdown_sender, shutdown) = watch::channel(false);
    let worker_config = config.clone();
    let worker_sink = sink.clone();
    let mut worker = tokio::spawn(async move {
        consumer::run(worker_config, &NeverLaunch, worker_sink, shutdown).await
    });
    time::timeout(Duration::from_secs(5), committed.notified()).await?;
    shutdown_sender.send(true)?;
    let early = time::timeout(Duration::from_millis(100), &mut worker).await;
    let returned_before_reply = early.is_ok();
    release.notify_one();
    match early {
        Ok(result) => result??,
        Err(_elapsed) => time::timeout(Duration::from_secs(5), worker).await???,
    }
    let state = observer
        .query_one(
            "SELECT j.status, s.owner IS NULL FROM ocr_jobs j CROSS JOIN worker_execution_slots s \
         WHERE j.id = $1 AND s.slot_key = 'shared-heavy-work'",
            &[&TAKEOVER.job_id],
        )
        .await?;
    let pending: StreamPendingReply = redis.xpending(&stream, group).await?;
    let _: usize = redis.del(&stream).await?;
    assert_eq!(
        state.try_get::<_, String>(0)?,
        "queued",
        "a graceful stop must requeue its acquired claim"
    );
    assert!(
        !returned_before_reply,
        "shutdown discarded the result of a committed OCR claim"
    );
    assert!(
        state.try_get::<_, bool>(1)?,
        "a graceful stop must release the acquired slot"
    );
    assert_eq!(
        pending.count(),
        1,
        "shutdown must preserve the source delivery"
    );

    // If the result never arrives, the worker must fail within the operation bound and leave
    // durable ownership and the unacknowledged delivery available to the recovery path.
    prepare_database(observer).await?;
    insert_fixture(observer, &TAKEOVER).await?;
    let _uncertain_message_id: String = append.query_async(&mut redis).await?;
    let (_timeout_shutdown_sender, timeout_shutdown) = watch::channel(false);
    let uncertain_worker =
        tokio::spawn(
            async move { consumer::run(config, &NeverLaunch, sink, timeout_shutdown).await },
        );
    time::timeout(Duration::from_secs(5), committed.notified()).await?;
    let result = time::timeout(Duration::from_secs(3), uncertain_worker).await??;
    assert!(matches!(
        result,
        Err(OcrConsumerError::Control("ocr_claim_timeout"))
    ));
    let uncertain_state = observer
        .query_one(
            "SELECT j.status, s.owner IS NOT NULL FROM ocr_jobs j CROSS JOIN worker_execution_slots s \
         WHERE j.id = $1 AND s.slot_key = 'shared-heavy-work'",
            &[&TAKEOVER.job_id],
        )
        .await?;
    let uncertain_pending: StreamPendingReply = redis.xpending(&stream, group).await?;
    let _: usize = redis.del(&stream).await?;
    assert_eq!(uncertain_state.try_get::<_, String>(0)?, "running");
    assert!(uncertain_state.try_get::<_, bool>(1)?);
    assert_eq!(
        uncertain_pending.count(),
        1,
        "an uncertain claim must remain pending"
    );
    Ok(())
}

fn append_fixture(stream: &str) -> SmokeResult<redis::Cmd> {
    let payload = persisted_payload(&TAKEOVER);
    let mut append = redis::cmd("XADD");
    append.arg(stream).arg("*");
    for (name, value) in payload.as_object().ok_or("OCR fixture object missing")? {
        append
            .arg(name)
            .arg(value.as_str().ok_or("OCR fixture value is not text")?);
    }
    Ok(append)
}

fn consumer_config(
    database_url: &str,
    redis_url: &str,
    stream: &str,
    group: &str,
) -> SmokeResult<OcrConsumerConfig> {
    let queue = OcrQueueConfig::new(
        String::from(stream),
        String::from(group),
        format!("{stream}:dead"),
        String::from("ocr-c2-worker-a"),
        Duration::from_secs(10),
        Duration::from_millis(100),
        2,
        10,
    )?;
    let control = OcrControlConfig::new(
        String::from("ocr-c2-worker-a"),
        Duration::from_secs(5),
        Duration::from_secs(1),
        Duration::from_millis(100),
    )?;
    let objects = R2ObjectStoreConfig::new(
        "http://127.0.0.1:1",
        "unused-test-bucket",
        String::from("unused-key"),
        String::from("unused-secret"),
        Duration::from_millis(200),
        Duration::from_millis(100),
        1,
    )?;
    let timing = OcrConsumerTiming::new(
        Duration::from_millis(50),
        Duration::from_mins(5),
        Duration::from_secs(1),
        Duration::from_millis(50),
    )?;
    Ok(OcrConsumerConfig::new(
        String::from(database_url),
        String::from(redis_url),
        queue,
        control,
        objects,
        timing,
    )?)
}

struct NeverLaunch;

impl OcrChildLauncher for NeverLaunch {
    fn launch(
        &self,
        _image: VerifiedSourceImage,
        _screen_type: RequestedScreenType,
        _hints: &OcrHints,
    ) -> Result<Box<dyn OcrChildHandle>, &'static str> {
        Err("shutdown must requeue before starting a child")
    }
}
