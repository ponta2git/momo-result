//! Linux parent-liveness process contract.

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
    reason = "Linux process-isolation tests require documented process-control FFI boundaries"
)]
mod tests {
    use std::{error::Error, fs, io, path::Path, process::Stdio, time::Duration};

    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        process::{Child, Command},
        sync::Mutex,
        time::{sleep, timeout},
    };

    type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
    const PROCESS_DEADLINE: Duration = Duration::from_secs(5);
    // Subreaper adoption and waitpid(-1) are process-wide. Serialize only this executable's
    // probes, so its adopted children always belong to the fixture currently being cleaned up.
    static PROBE_LOCK: Mutex<()> = Mutex::const_new(());

    #[tokio::test]
    async fn killing_the_parent_does_not_leave_the_child_running() -> TestResult {
        let _guard = PROBE_LOCK.lock().await;
        configure_subreaper()?;
        let parent = Command::new(env!("CARGO_BIN_EXE_momo-processing-worker"))
            .arg("probe-parent-death")
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        verify_parent_death(parent, PROCESS_DEADLINE).await
    }

    async fn verify_parent_death(mut parent: Child, readiness_deadline: Duration) -> TestResult {
        let readiness = timeout(readiness_deadline, reported_child(&mut parent)).await;
        let observation: TestResult = async {
            timeout(PROCESS_DEADLINE, parent.kill()).await??;
            let child_id = readiness??;
            // A simulated clock cannot establish whether this real orphan actually exited.
            timeout(PROCESS_DEADLINE, reap_orphan(child_id)).await??;
            Ok(())
        }
        .await;

        // Always clean up, including when the parent never reports a usable child id. The direct
        // parent must be dead before descendants can be adopted; process-group kills are not
        // sufficient because the production probe's child creates a separate process group.
        let cleanup: TestResult = async {
            timeout(PROCESS_DEADLINE, parent.kill()).await??;
            timeout(PROCESS_DEADLINE, cleanup_adopted_children()).await??;
            Ok(())
        }
        .await;
        match (observation, cleanup) {
            (Ok(()), result) | (result, Ok(())) => result,
            (Err(observed), Err(cleanup_error)) => {
                Err(format!("{observed}; probe cleanup failed: {cleanup_error}").into())
            }
        }
    }

    fn configure_subreaper() -> io::Result<()> {
        // SAFETY: only this isolated integration-test executable becomes a subreaper. Every
        // fixture holds PROBE_LOCK until its direct and adopted children have been reaped.
        if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    async fn reported_child(parent: &mut Child) -> TestResult<libc::pid_t> {
        let stdout = parent
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("parent-death probe did not expose stdout"))?;
        let line = BufReader::new(stdout)
            .lines()
            .next_line()
            .await?
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "probe exited before readiness",
                )
            })?;
        let child_id = line.trim().parse::<libc::pid_t>()?;
        if child_id <= 0 {
            return Err(io::Error::other("probe reported an invalid child process id").into());
        }
        Ok(child_id)
    }

    async fn reap_orphan(child_id: libc::pid_t) -> io::Result<()> {
        loop {
            let mut status = 0;
            // SAFETY: child_id identifies the probe's adopted child and status is writable.
            let reaped = unsafe { libc::waitpid(child_id, &raw mut status, libc::WNOHANG) };
            if reaped == child_id {
                return Ok(());
            }
            if reaped < 0 {
                return Err(io::Error::last_os_error());
            }
            sleep(Duration::from_millis(10)).await;
        }
    }

    async fn cleanup_adopted_children() -> io::Result<()> {
        loop {
            // Adoption may target any thread in this process. /proc lists only immediate
            // children and may omit an exiting child, so rescan after killing/reaping each wave.
            // ECHILD from waitpid, not an empty /proc listing, is the completion condition.
            for task in fs::read_dir("/proc/self/task")? {
                let children = match fs::read_to_string(task?.path().join("children")) {
                    Ok(children) => children,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                };
                for child in children.split_whitespace() {
                    let child_id = child.parse::<libc::pid_t>().map_err(io::Error::other)?;
                    if child_id <= 0 {
                        return Err(io::Error::other("invalid adopted child process id"));
                    }
                    // SAFETY: the parent was reaped and PROBE_LOCK excludes other fixture
                    // owners. No await or reap intervenes before signalling these adopted ids,
                    // so even an exited child's id cannot be reused before this call.
                    if unsafe { libc::kill(child_id, libc::SIGKILL) } != 0 {
                        return Err(io::Error::last_os_error());
                    }
                }
            }
            loop {
                let mut status = 0;
                // SAFETY: -1 selects only this test process's children; status is writable.
                let reaped = unsafe { libc::waitpid(-1, &raw mut status, libc::WNOHANG) };
                if reaped == 0 {
                    break;
                }
                if reaped < 0 {
                    let error = io::Error::last_os_error();
                    return if error.raw_os_error() == Some(libc::ECHILD) {
                        Ok(())
                    } else {
                        Err(error)
                    };
                }
            }
            sleep(Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    async fn readiness_failures_reap_children_without_a_reported_pid() -> TestResult {
        let _guard = PROBE_LOCK.lock().await;
        configure_subreaper()?;
        for mode in ["timeout", "eof", "malformed"] {
            let directory = tempfile::tempdir()?;
            let child_file = directory.path().join("child-pid");
            let parent = Command::new("/bin/sh")
                .args(["-c", r#"
                    setsid /bin/sh -c 'printf "%s\n" "$$" > "$1"; exec /bin/sleep 30' child "$1" >/dev/null 2>&1 &
                    case "$2" in
                        timeout) ;;
                        eof) exit 0 ;;
                        malformed) printf 'not-a-pid\n' ;;
                    esac
                    exec /bin/sleep 30
                "#, "readiness-fixture"])
                .arg(&child_file)
                .arg(mode)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .process_group(0)
                .kill_on_drop(true)
                .spawn()?;
            // This independent file only records the oracle's child identity. The cleanup under
            // test sees solely the deliberately missing/broken stdout readiness protocol.
            let started = timeout(PROCESS_DEADLINE, fixture_child_id(&child_file)).await;
            let result = verify_parent_death(parent, Duration::from_millis(25)).await;
            let evidence: TestResult = (|| {
                let child_id = started??;
                let error = result.err().ok_or("broken readiness was accepted")?;
                let expected_error = match mode {
                    "timeout" => error.is::<tokio::time::error::Elapsed>(),
                    "eof" => error
                        .downcast_ref::<io::Error>()
                        .is_some_and(|error| error.kind() == io::ErrorKind::UnexpectedEof),
                    "malformed" => error.is::<std::num::ParseIntError>(),
                    _ => false,
                };
                if !expected_error {
                    return Err(
                        format!("{mode}: original readiness failure was lost: {error}").into(),
                    );
                }
                if Path::new(&format!("/proc/{child_id}")).exists() {
                    return Err(format!("{mode}: fixture child is still live or unreaped").into());
                }
                let mut status = 0;
                // SAFETY: this is the fixture child's recorded id and status is writable.
                let reaped = unsafe { libc::waitpid(child_id, &raw mut status, libc::WNOHANG) };
                if reaped != -1 || io::Error::last_os_error().raw_os_error() != Some(libc::ECHILD) {
                    return Err(format!("{mode}: fixture child was not already reaped").into());
                }
                Ok(())
            })();
            // Keep the regression fixture contained even if its oracle catches a cleanup bug.
            timeout(PROCESS_DEADLINE, cleanup_adopted_children()).await??;
            evidence?;
        }
        Ok(())
    }

    async fn fixture_child_id(path: &Path) -> TestResult<libc::pid_t> {
        loop {
            match fs::read_to_string(path) {
                Ok(value) if !value.trim().is_empty() => {
                    let child_id = value.trim().parse()?;
                    // SAFETY: getpgid only inspects the test-owned child. The inner shell writes
                    // its id after setsid, proving that parent-group cleanup cannot reach it.
                    if unsafe { libc::getpgid(child_id) } != child_id {
                        return Err("fixture child did not establish its own process group".into());
                    }
                    return Ok(child_id);
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            sleep(Duration::from_millis(10)).await;
        }
    }
}
