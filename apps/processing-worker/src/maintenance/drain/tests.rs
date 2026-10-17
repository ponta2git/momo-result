use super::*;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn request(stage: Stage) -> Request {
    Request {
        cutover_id: String::from("cutover-test"),
        stop_epoch: 1,
        stage,
    }
}

#[test]
fn identities_and_tokens_are_bounded_without_echoing_configuration() {
    assert!(
        request(Stage::Admission).valid(),
        "valid request was rejected"
    );
    for cutover_id in ["", "-cutover", "cutover/other", "has space"] {
        assert!(
            !Request {
                cutover_id: cutover_id.to_owned(),
                ..request(Stage::All)
            }
            .valid(),
            "invalid identity was accepted"
        );
    }
    for stop_epoch in [0, 9_007_199_254_740_992] {
        assert!(
            !Request {
                stop_epoch,
                ..request(Stage::All)
            }
            .valid(),
            "invalid epoch was accepted"
        );
    }
    assert!(
        valid_token("abcdefghijklmnopqrstuvwxyz123456=="),
        "valid token was rejected"
    );
    for token in [
        "short",
        "abcdefghijklmnopqrstuvwxyz 123456",
        "abcdefghijklmnopqrstuvwxyz=123456",
    ] {
        assert!(!valid_token(token), "invalid token was accepted");
    }
}

#[test]
fn monotonic_barrier_preserves_the_original_identity_and_terminal_failure() {
    let control = Control::new(false, Duration::from_secs(20));
    assert!(
        control.request(request(Stage::Admission)).is_ok(),
        "admission failed"
    );
    assert!(
        control.request(request(Stage::Admission)).is_ok(),
        "replay failed"
    );
    assert_eq!(
        control.snapshot().phase,
        "draining",
        "receipt preceded owned I/O"
    );
    control.admission_settled();
    assert_eq!(
        control.snapshot().phase,
        "drained",
        "admission did not settle"
    );
    assert!(
        control
            .request(Request {
                stop_epoch: 2,
                ..request(Stage::Admission)
            })
            .is_err(),
        "identity changed"
    );
    assert!(control.request(request(Stage::All)).is_ok(), "all failed");
    assert!(
        control.request(request(Stage::Admission)).is_err(),
        "stage regressed"
    );
    control.runtime_settled(Err(FailureKind::Failed));
    control.runtime_settled(Ok(()));
    assert_eq!(
        control.snapshot().phase,
        "failed",
        "late completion erased a failure"
    );
}

#[tokio::test]
async fn timeout_is_terminal_even_without_an_intermediate_observation() {
    let control = Control::new(false, Duration::from_millis(1));
    assert!(control.request(request(Stage::All)).is_ok(), "all failed");
    time::sleep(Duration::from_millis(10)).await;
    control.runtime_settled(Ok(()));
    assert_eq!(
        control.snapshot().phase,
        "timed_out",
        "late completion erased timeout"
    );
    assert!(control.all_requested(), "timeout reopened writers");
}

#[tokio::test]
#[expect(
    clippy::panic_in_result_fn,
    reason = "assertions verify the live socket boundary while fixture setup propagates I/O errors"
)]
async fn private_socket_attests_its_live_process_and_rejects_wrong_tokens() -> TestResult {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("maintenance.sock");
    let token = String::from("abcdefghijklmnopqrstuvwxyz123456");
    let server = Server::bind(
        Configuration {
            path: path.clone(),
            token: token.clone(),
        },
        true,
    )
    .await?;
    assert_eq!(
        std::fs::metadata(&path)?.permissions().mode() & 0o777,
        0o600,
        "socket permissions are broad"
    );
    let wrong = Frame {
        token: String::from("different"),
        method: String::from("POST"),
        request: Some(request(Stage::All)),
    };
    assert!(
        matches!(server.respond(wrong), Err(ErrorCode::Unauthorized)),
        "wrong token reached drain"
    );
    assert!(
        !server.control.admission_closed(),
        "unauthorized drain closed admission"
    );
    let configuration = Configuration {
        path: path.clone(),
        token,
    };
    let exchange = async {
        let snapshot = send(&configuration, Some(request(Stage::All))).await?;
        assert_eq!(
            snapshot.phase, "drained",
            "frozen process did not attest closure"
        );
        assert_eq!(
            snapshot.process_id,
            std::process::id(),
            "receipt came from another process"
        );
        let replay = send(&configuration, None).await?;
        assert_eq!(
            replay.cutover_id.as_deref(),
            Some("cutover-test"),
            "status lost identity"
        );
        TestResult::Ok(())
    };
    tokio::select! {
        result = server.serve() => { result?; Err("control server unexpectedly exited".into()) },
        result = exchange => result,
    }?;
    drop(server);
    assert!(!path.exists(), "socket outlived its process owner");
    Ok(())
}
