//! Real row locks distinguish targeted Busy recovery from ordinary wake and deadline scans.

use super::*;

pub(super) const IDS: [&str; 9] = [
    "00000000-0024-4000-8000-000000000018",
    "00000000-0024-4000-8000-000000000019",
    "00000000-0024-4000-8000-000000000020",
    "00000000-0024-4000-8000-000000000021",
    "00000000-0024-4000-8000-000000000022",
    "00000000-0024-4000-8000-000000000023",
    "00000000-0024-4000-8000-000000000024",
    "00000000-0024-4000-8000-000000000025",
    "00000000-0024-4000-8000-000000000026",
];

pub(super) async fn verify(primary: &Client, peer: &mut Client, url: &str) -> TestResult {
    verify_targeted_recovery(primary, peer, url).await?;
    verify_shared_budget(primary, peer, url).await?;
    verify_admission_deadline(primary, peer, url).await?;
    verify_invalid_target_is_isolated(primary, peer, url).await
}

async fn verify_targeted_recovery(primary: &Client, peer: &mut Client, url: &str) -> TestResult {
    let [busy, open, ..] = IDS;
    for (id, deadline) in [(busy, -1), (open, 600)] {
        create(primary, id, deadline).await?;
        member(primary, id, "total_assets", None).await?;
    }
    let lock = peer.transaction().await?;
    lock.query_one(
        "SELECT id FROM match_drafts WHERE id = $1 FOR UPDATE",
        &[&busy],
    )
    .await?;
    let (_wake, receiver) = watch::channel(());
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut scans) = watch::channel(0_u64);
    let (rechecked, mut attempts) = watch::channel(0_u64);
    let schedule = Schedule {
        observed: Some(observed),
        rechecked: Some(rechecked),
        ..Schedule::default()
    };
    let database = postgres::connect(url).await?;
    let mut recovery = Recovery::default();
    let runtime = coordinate(
        database,
        receiver,
        stop,
        TIMEOUT,
        NotificationSink::default(),
        schedule,
        &mut recovery,
    );
    let check = async {
        time::timeout(Duration::from_secs(2), scans.changed()).await??;
        // Make the non-Busy submission eligible without a wake. Only the locked ID may be rechecked.
        primary.execute("UPDATE ocr_submissions SET admission_deadline = clock_timestamp() - interval '1 second' WHERE id = $1", &[&open]).await?;
        lock.rollback().await?;
        time::timeout(Duration::from_secs(2), attempts.changed()).await??;
        ensure(
            status(primary, busy).await? == "settled",
            "lock release without a hint settles before the safety scan",
        )?;
        ensure(
            status(primary, open).await? == "open",
            "an ordinary Open result does not enter targeted recovery",
        )?;
        ensure(
            *scans.borrow() == 1 && *attempts.borrow() == 1,
            "one targeted retry must not perform an open-submission scan",
        )?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stopped = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (runtime, assertion) = tokio::join!(runtime, stopped);
    runtime?;
    assertion
}

async fn verify_shared_budget(primary: &Client, peer: &mut Client, url: &str) -> TestResult {
    let [_, _, first, second, third, fourth, ..] = IDS;
    let busy = [first, second, third, fourth];
    for id in busy {
        create(primary, id, -1).await?;
        member(primary, id, "total_assets", None).await?;
    }
    let lock = peer.transaction().await?;
    lock.query(
        "SELECT id FROM match_drafts WHERE id = ANY($1) ORDER BY id FOR UPDATE",
        &[&busy.as_slice()],
    )
    .await?;
    let (wake, receiver) = watch::channel(());
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut scans) = watch::channel(0_u64);
    let (rechecked, mut attempts) = watch::channel(0_u64);
    let schedule = Schedule {
        observed: Some(observed),
        rechecked: Some(rechecked),
        ..Schedule::default()
    };
    let database = postgres::connect(url).await?;
    let mut recovery = Recovery::default();
    let runtime = coordinate(
        database,
        receiver,
        stop,
        TIMEOUT,
        NotificationSink::default(),
        schedule,
        &mut recovery,
    );
    let check = async {
        time::timeout(Duration::from_secs(2), scans.changed()).await??;
        time::timeout(Duration::from_secs(3), async {
            while *attempts.borrow_and_update() < 3 {
                attempts.changed().await?;
            }
            Ok::<(), watch::error::RecvError>(())
        })
        .await??;
        wake.send(())?;
        time::timeout(Duration::from_secs(2), scans.changed()).await??;
        ensure(
            time::timeout(Duration::from_millis(2500), attempts.changed())
                .await
                .is_err(),
            "a normal wake cannot reset the consumer-wide extra-attempt budget",
        )?;
        ensure(
            *scans.borrow() == 2 && *attempts.borrow() == 3,
            "different Busy IDs share three extra attempts without extra scans",
        )?;
        lock.rollback().await?;
        wake.send(())?;
        time::timeout(Duration::from_secs(2), scans.changed()).await??;
        for id in busy {
            ensure(
                status(primary, id).await? == "settled",
                "budget exhaustion leaves normal wake recovery available",
            )?;
        }
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stopped = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (runtime, assertion) = tokio::join!(runtime, stopped);
    runtime?;
    assertion
}

async fn verify_admission_deadline(primary: &Client, peer: &mut Client, url: &str) -> TestResult {
    let [_, _, _, _, _, _, id, ..] = IDS;
    create(primary, id, 2).await?;
    member(primary, id, "total_assets", None).await?;
    let lock = peer.transaction().await?;
    lock.query_one(
        "SELECT id FROM match_drafts WHERE id = $1 FOR UPDATE",
        &[&id],
    )
    .await?;
    let (_wake, receiver) = watch::channel(());
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut scans) = watch::channel(0_u64);
    let (rechecked, mut attempts) = watch::channel(0_u64);
    let schedule = Schedule {
        observed: Some(observed),
        rechecked: Some(rechecked),
        ..Schedule::default()
    };
    let database = postgres::connect(url).await?;
    let mut recovery = Recovery::default();
    let runtime = coordinate(
        database,
        receiver,
        stop,
        TIMEOUT,
        NotificationSink::default(),
        schedule,
        &mut recovery,
    );
    let check = async {
        time::timeout(Duration::from_secs(2), scans.changed()).await??;
        time::timeout(Duration::from_secs(2), attempts.changed()).await??;
        lock.rollback().await?;
        time::timeout(Duration::from_millis(1400), scans.changed()).await??;
        ensure(
            status(primary, id).await? == "settled",
            "Busy retries must preserve the original admission deadline scan",
        )?;
        ensure(
            *attempts.borrow() == 1,
            "the deadline scan takes priority over another optional retry",
        )?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stopped = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (runtime, assertion) = tokio::join!(runtime, stopped);
    runtime?;
    assertion
}

async fn verify_invalid_target_is_isolated(
    primary: &Client,
    peer: &mut Client,
    url: &str,
) -> TestResult {
    let [.., invalid, healthy] = IDS;
    create(primary, invalid, -1).await?;
    create(primary, healthy, -1).await?;
    member(primary, healthy, "total_assets", None).await?;
    let lock = peer.transaction().await?;
    lock.query(
        "SELECT id FROM match_drafts WHERE id = ANY($1) ORDER BY id FOR UPDATE",
        &[&[invalid, healthy].as_slice()],
    )
    .await?;
    let (_wake, receiver) = watch::channel(());
    let (shutdown, stop) = watch::channel(false);
    let (observed, mut scans) = watch::channel(0_u64);
    let (rechecked, mut attempts) = watch::channel(0_u64);
    let schedule = Schedule {
        observed: Some(observed),
        rechecked: Some(rechecked),
        ..Schedule::default()
    };
    let database = postgres::connect(url).await?;
    let mut recovery = Recovery::default();
    let runtime = coordinate(
        database,
        receiver,
        stop,
        TIMEOUT,
        NotificationSink::default(),
        schedule,
        &mut recovery,
    );
    let check = async {
        time::timeout(Duration::from_secs(2), scans.changed()).await??;
        lock.rollback().await?;
        time::timeout(Duration::from_secs(2), async {
            while *attempts.borrow_and_update() < 2 {
                attempts.changed().await?;
            }
            Ok::<(), watch::error::RecvError>(())
        })
        .await??;
        ensure(
            status(primary, invalid).await? == "open",
            "invalid targets must roll back",
        )?;
        ensure(
            status(primary, healthy).await? == "settled",
            "an invalid target must not reconnect the coordinator before the next healthy retry",
        )?;
        ensure(
            *scans.borrow() == 1,
            "target errors do not require another full scan",
        )?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let stopped = async {
        let result = check.await;
        shutdown.send(true)?;
        result
    };
    let (runtime, assertion) = tokio::join!(runtime, stopped);
    runtime?;
    assertion
}

async fn status(client: &Client, id: &str) -> TestResult<String> {
    Ok(client
        .query_one("SELECT status FROM ocr_submissions WHERE id = $1", &[&id])
        .await?
        .get(0))
}
