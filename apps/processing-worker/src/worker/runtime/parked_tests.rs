//! Real PostgreSQL and the production writer follower share the scheduler used by the service.
use super::{reconciliation_tests, *};
use crate::notifications::NotificationSink;
use std::error::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};
use tokio_postgres::Client;
use url::Url;

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
const NAME: &str = "momo-parked-worker-test";
const ID: &str = "00000000-0015-4a00-8000-000000000999";
const FALLBACK: Duration = Duration::from_millis(100);
const BOUND: Duration = Duration::from_secs(10);

#[tokio::test]
#[ignore = "requires explicitly isolated PROCESSING_SCHEDULER_SMOKE_DATABASE_URL"]
async fn real_postgres_long_poll_timeouts_leave_idle_connections_parked() -> TestResult {
    if std::env::var("ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED").as_deref() != Ok("true") {
        return Err("isolated database authorization is required".into());
    }
    let url = std::env::var("PROCESSING_SCHEDULER_SMOKE_DATABASE_URL")?;
    let observer = crate::identity::fixtures::connect(&url).await?;
    let ids = [ID.to_owned()];
    reconciliation_tests::cleanup(&observer, &ids).await?;
    let mut named_url = Url::parse(&url)?;
    named_url
        .query_pairs_mut()
        .append_pair("application_name", NAME);
    let until_supervisor = crate::worker::until_supervisor(std::time::SystemTime::now());
    if until_supervisor < BOUND {
        time::sleep(until_supervisor).await;
    }
    let result = time::timeout(BOUND, verify(named_url.as_str(), &observer, &ids)).await;
    let cleaned = reconciliation_tests::cleanup(&observer, &ids).await;
    result??;
    cleaned
}

async fn verify(database: &str, observer: &Client, ids: &[String]) -> TestResult {
    let peer = TcpListener::bind("127.0.0.1:0").await?;
    let peer_url = Url::parse(&format!(
        "http://{}/internal/worker/wake",
        peer.local_addr()?
    ))?;
    let (shutdown, stop) = watch::channel(false);
    let (sink, wake) = PostCommitSink::channel();
    let mut runtime = Runtime::new(stop, BOUND, Duration::from_secs(1));
    runtime.wake = Some(wake);
    runtime.submissions = Some(
        ocr::submissions::runtime::Reconciler::initialize(
            database.to_owned(),
            BOUND,
            NotificationSink::default(),
        )
        .await?,
    );
    let settings = Settings {
        database_url: database.to_owned(),
        resource_limits: ResourceLimits::fixture(),
        worker_id: NAME.to_owned(),
        operation_timeout: BOUND,
        ocr_stale_after: Duration::from_mins(5),
        recovery_interval: FALLBACK,
    };
    let mut work = Some(WorkState::new(
        settings,
        None,
        postgres::connect(database).await?,
        sink.clone(),
    ));
    let monitor = runtime.monitor.clone();
    let observe = async {
        let result = verify_polls(peer, &monitor, observer, ids).await;
        shutdown.send_replace(true);
        result
    };
    let follower = wake_http::follow_test_writer(peer_url, &monitor, &sink);
    let worker = async {
        let (scheduler, assertions) = tokio::join!(drive(&mut runtime, &mut work), observe);
        scheduler?;
        assertions
    };
    let result = tokio::select! {
        result = worker => result,
        result = follower => { result?; Err("writer follower stopped unexpectedly".into()) }
    };
    drop(runtime);
    result
}

async fn verify_polls(
    peer: TcpListener,
    monitor: &wake_http::WakeMonitor,
    observer: &Client,
    ids: &[String],
) -> TestResult {
    respond(poll(&peer, None).await?, 0).await?;
    let mut pending = poll(&peer, Some(0)).await?;
    // A second GET proves that the first cursor, including its new-boot grace period, arrived.
    monitor.settle_test_writer();
    loop {
        if monitor.healthy() && parked(observer).await? {
            break;
        }
        time::sleep(Duration::from_millis(10)).await;
    }
    // A committed row with its signal withheld exposes even a short-lived reconnect and rescan.
    reconciliation_tests::create(observer, ID).await?;
    for _ in 0..2 {
        time::sleep(FALLBACK * 2).await;
        respond(pending, 0).await?;
        pending = poll(&peer, Some(0)).await?;
    }
    let open: bool = observer
        .query_one(
            "SELECT status = 'open' FROM ocr_submissions WHERE legacy_id=$1",
            &[&ID],
        )
        .await?
        .try_get(0)?;
    if !open || !parked(observer).await? {
        return Err(
            "unchanged long polls scanned a receipt or reopened a parked database session".into(),
        );
    }
    respond(pending, 1).await?;
    let _next = poll(&peer, Some(1)).await?;
    reconciliation_tests::wait_for_settled(observer, ids, 1).await
}

async fn parked(observer: &Client) -> TestResult<bool> {
    Ok(observer
        .query_one(
            "SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE application_name=$1)",
            &[&NAME],
        )
        .await?
        .try_get(0)?)
}

async fn poll(peer: &TcpListener, cursor: Option<u64>) -> TestResult<TcpStream> {
    let (stream, _) = peer.accept().await?;
    let mut request = BufReader::new(stream);
    let mut header = String::new();
    request.read_line(&mut header).await?;
    if !header.starts_with("GET /internal/worker/wake")
        || cursor.is_some_and(|expected| !header.contains(&format!("cursor={expected} ")))
    {
        return Err("writer did not resume the expected cursor".into());
    }
    loop {
        header.clear();
        request.read_line(&mut header).await?;
        if header == "\r\n" {
            return Ok(request.into_inner());
        }
        if header.is_empty() {
            return Err("missing end of HTTP request".into());
        }
    }
}

async fn respond(mut stream: TcpStream, cursor: u64) -> TestResult {
    let body = format!(r#"{{"boot":"fc2175ff-9cdc-4ebb-b14f-f30a471f62ac","cursor":{cursor}}}"#);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}
