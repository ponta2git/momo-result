//! An opt-in test process that replaces only native OCR execution. Real image downloads,
//! Redis consumption, database fencing, submission coordination and notification HTTP remain.

use super::{
    consumer::{
        self, OcrChildHandle, OcrChildLauncher, OcrChildLiveness, OcrChildProcessFailure,
        OcrChildTerminationFuture, OcrChildWaitFuture,
    },
    contract::{OcrHints, RequestedScreenType},
    object_store::VerifiedSourceImage,
    runtime_config::{OcrConsumerMode, OcrConsumerRuntimeConfig},
    submissions,
};
use crate::{
    notifications::{NotificationConfig, NotificationDriver},
    outbox::PostCommitSink,
};
use std::{
    error::Error,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{sync::watch, time};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

#[tokio::test]
#[ignore = "controlled worker process for the isolated MOM-24 E2E harness"]
async fn controlled_worker_process() -> TestResult {
    if std::env::var("ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED").as_deref() != Ok("true") {
        return Err("isolated runtime authorization is required".into());
    }
    let control_dir = PathBuf::from(std::env::var("MOM24_E2E_CONTROL_DIR")?).canonicalize()?;
    if !control_dir.is_dir() {
        return Err("test control directory is required".into());
    }
    let database = std::env::var("OCR_CONTROL_SMOKE_DATABASE_URL")?;
    let redis = std::env::var("OCR_CONTROL_SMOKE_REDIS_URL")?;
    let OcrConsumerRuntimeConfig::Enabled(config) = OcrConsumerRuntimeConfig::from_environment(
        OcrConsumerMode::Enabled,
        database.clone(),
        redis,
        Duration::from_secs(5),
    )?
    else {
        return Err("controlled OCR runtime is disabled".into());
    };
    let submission_config = submissions::runtime::Config {
        database_url: database.clone(),
        listener_database_url: database,
        finalization_timeout: config.shutdown_finalization_bound(),
    };
    let (notifications, driver) = NotificationDriver::new(NotificationConfig::from_environment()?)?;
    let (sink, _wake) = PostCommitSink::channel();
    let (shutdown, stop) = watch::channel(false);
    let launcher = Launcher {
        directory: control_dir.clone(),
        sequence: AtomicU64::new(0),
    };
    let computation = consumer::run(*config, &launcher, sink, stop.clone());
    let (observed, mut checkpoints) = watch::channel(0_u64);
    let coordination = submissions::runtime::run_observed(
        submission_config,
        notifications,
        stop.clone(),
        observed,
    );
    let checkpoint_directory = control_dir.clone();
    let checkpoint_writer = async move {
        let mut stop = stop;
        loop {
            tokio::select! {
                changed = checkpoints.changed() => {
                    if changed.is_err() { return Ok::<(), Box<dyn Error + Send + Sync>>(()); }
                    let count = *checkpoints.borrow_and_update();
                    tokio::fs::write(checkpoint_directory.join("coordinator.checkpoint"), count.to_string()).await?;
                }
                changed = stop.changed() => { if changed.is_err() || *stop.borrow() { return Ok(()); } }
            }
        }
    };
    let watch_stop = async {
        tokio::fs::write(control_dir.join("process.started"), b"fixture-worker\n").await?;
        let wait = async {
            while !control_dir.join("stop").exists() {
                time::sleep(Duration::from_millis(25)).await;
            }
        };
        let result = time::timeout(Duration::from_mins(15), wait).await;
        shutdown.send(true)?;
        result?;
        Ok::<(), Box<dyn Error + Send + Sync>>(())
    };
    let work = async {
        let result = tokio::try_join!(
            async {
                computation
                    .await
                    .map_err(|error| -> Box<dyn Error + Send + Sync> { Box::new(error) })
            },
            async {
                coordination
                    .await
                    .map_err(|error| -> Box<dyn Error + Send + Sync> { Box::new(error) })
            },
            watch_stop,
            checkpoint_writer
        );
        shutdown.send_replace(true);
        result
    };
    let (business, ()) = tokio::join!(work, driver.run());
    business?;
    Ok(())
}

struct Launcher {
    directory: PathBuf,
    sequence: AtomicU64,
}
struct Child {
    directory: PathBuf,
    screen: RequestedScreenType,
    cancelled: Arc<AtomicBool>,
    image: VerifiedSourceImage,
}
struct Liveness;

impl OcrChildLiveness for Liveness {
    fn refresh(&mut self) -> Result<(), &'static str> {
        Ok(())
    }
}

impl OcrChildLauncher for Launcher {
    fn launch(
        &self,
        image: VerifiedSourceImage,
        screen: RequestedScreenType,
        _hints: &OcrHints,
    ) -> Result<Box<dyn OcrChildHandle>, &'static str> {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        std::fs::write(
            self.directory.join(format!("{}.started", screen.wire())),
            sequence.to_string(),
        )
        .map_err(|_error| "fixture_control_write")?;
        Ok(Box::new(Child {
            directory: self.directory.clone(),
            screen,
            cancelled: Arc::new(AtomicBool::new(false)),
            image,
        }))
    }
}

impl OcrChildHandle for Child {
    fn liveness(&self) -> Result<Box<dyn OcrChildLiveness>, &'static str> {
        Ok(Box::new(Liveness))
    }

    fn wait(&mut self) -> OcrChildWaitFuture<'_> {
        Box::pin(async move {
            if self.image.width() == 0 || self.image.height() == 0 {
                return Err(OcrChildProcessFailure::ProcessBoundary(
                    "fixture_empty_image",
                ));
            }
            let mode_path = self
                .directory
                .join(format!("{}.outcome", self.screen.wire()));
            let mode = tokio::fs::read_to_string(mode_path)
                .await
                .map_err(|_error| {
                    OcrChildProcessFailure::ProcessBoundary("fixture_outcome_missing")
                })?;
            let mode = mode.trim();
            if mode.starts_with("hold:") {
                while !self
                    .directory
                    .join(format!("{}.release", self.screen.wire()))
                    .exists()
                {
                    if self.cancelled.load(Ordering::Relaxed) {
                        return Err(OcrChildProcessFailure::ProcessBoundary("fixture_cancelled"));
                    }
                    time::sleep(Duration::from_millis(10)).await;
                }
            }
            let outcome = mode.strip_prefix("hold:").unwrap_or(mode);
            match outcome {
                "failed" => Ok(Err(momo_ocr::OcrFailure::ParserFailed)),
                "success" | "needs_review" => {
                    let mut completion = if outcome == "needs_review"
                        && self.screen == RequestedScreenType::TotalAssets
                    {
                        super::control::tests::completion_with_missing_amount_warning()
                    } else {
                        super::control::tests::valid_completion(self.screen)
                    };
                    completion.output.timings_milliseconds = serde_json::json!({"decode":0.0,"engine_initialization":0.0,"detect_player_order":0.0,"parse":0.0,"total":0.0});
                    Ok(Ok(completion.output))
                }
                _ => Err(OcrChildProcessFailure::ProcessBoundary(
                    "fixture_outcome_invalid",
                )),
            }
        })
    }

    fn terminate(&mut self) -> OcrChildTerminationFuture<'_> {
        self.cancelled.store(true, Ordering::Relaxed);
        Box::pin(async { Ok(()) })
    }
}
