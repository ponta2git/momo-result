#![cfg(target_os = "linux")]
#![forbid(unsafe_op_in_unsafe_fn)]
#![deny(
    clippy::expect_used,
    clippy::undocumented_unsafe_blocks,
    clippy::unwrap_used
)]

#[cfg(test)]
#[expect(
    unsafe_code,
    reason = "Linux process-isolation tests require prctl and waitpid at a documented FFI boundary"
)]
#[expect(
    clippy::panic,
    reason = "integration-test setup failures must abort with their OS or decoding context"
)]
mod tests {
    use std::{
        io::{BufRead, BufReader},
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    use momo_analysis::process::{HardLimitProbeResult, ProbeOutcome};

    #[test]
    fn operating_system_limit_terminates_only_the_child() {
        let output = Command::new(env!("CARGO_BIN_EXE_momo-analysis"))
            .args([
                "probe-hard-limit",
                "--limit-bytes",
                "134217728",
                "--allocation-bytes",
                "402653184",
                "--timeout-ms",
                "10000",
            ])
            .output()
            .unwrap_or_else(|error| panic!("failed to execute hard-limit probe: {error}"));

        assert!(
            output.status.success(),
            "probe failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let result: HardLimitProbeResult = serde_json::from_slice(&output.stdout)
            .unwrap_or_else(|error| panic!("invalid probe JSON: {error}"));
        assert_eq!(result.outcome, ProbeOutcome::ResourceLimitEnforced);
        assert!(result.parent_survived);
    }

    #[test]
    fn killing_the_parent_does_not_leave_the_child_running() {
        // SAFETY: this changes only the current test process into a Linux child subreaper so the
        // orphaned probe child can be reaped deterministically inside a minimal container.
        let subreaper_result = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) };
        assert_eq!(subreaper_result, 0, "failed to configure test subreaper");

        let mut parent = Command::new(env!("CARGO_BIN_EXE_momo-analysis"))
            .arg("probe-parent-death")
            .stdout(Stdio::piped())
            .spawn()
            .unwrap_or_else(|error| panic!("failed to execute parent-death probe: {error}"));
        let stdout = parent
            .stdout
            .take()
            .unwrap_or_else(|| panic!("parent-death probe did not expose stdout"));
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .unwrap_or_else(|error| panic!("failed to read child process id: {error}"));
        let child_id = line
            .trim()
            .parse::<i32>()
            .unwrap_or_else(|error| panic!("invalid child process id: {error}"));

        let kill_status = Command::new("kill")
            .args(["-KILL", &parent.id().to_string()])
            .status()
            .unwrap_or_else(|error| panic!("failed to kill probe parent: {error}"));
        assert!(kill_status.success(), "failed to kill probe parent");
        parent
            .wait()
            .unwrap_or_else(|error| panic!("failed to reap probe parent: {error}"));

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut status = 0;
            // SAFETY: child_id belongs to the probe process tree and status is a valid out pointer.
            let reaped = unsafe { libc::waitpid(child_id, &raw mut status, libc::WNOHANG) };
            if reaped == child_id {
                break;
            }
            assert!(
                reaped >= 0,
                "probe child was not owned by the test subreaper"
            );
            assert!(
                Instant::now() < deadline,
                "orphan child {child_id} was not terminated and reaped"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }
}
