use std::{error::Error, fs, future, io, path::PathBuf, process::Stdio, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{ChildStdin, Command},
    sync::{oneshot, watch},
    time::{self, Instant},
};

use super::RecoverableChild;
use crate::{
    cgroup::{CGROUP_DIRECTORY_NAME, CgroupHierarchy, ChildCgroup},
    execution::{CleanupState, ExecutionError, ExecutionHandle, spawn_child_io},
};

type TestResult = Result<(), Box<dyn Error>>;
const CLEANUP_GRACE: Duration = Duration::from_secs(2);

fn fixture() -> Result<(tempfile::TempDir, ChildCgroup, PathBuf), Box<dyn Error>> {
    let temporary = tempfile::tempdir()?;
    let directory = temporary.path().join(CGROUP_DIRECTORY_NAME);
    fs::create_dir(&directory)?;
    // Real process wait/reap and pipe cancellation are the oracle here. Actual cgroup attachment,
    // descendants, and hard limits remain the Linux image smoke's responsibility.
    for (name, value) in [
        ("cgroup.procs", ""),
        ("cpu.cfs_quota_us", "100000"),
        ("cpu.cfs_period_us", "100000"),
        ("memory.limit_in_bytes", "201326592\n"),
        ("memory.usage_in_bytes", "4096\n"),
        ("memory.max_usage_in_bytes", "8192\n"),
        ("memory.failcnt", "0\n"),
        (
            "memory.oom_control",
            "oom_kill_disable 0\nunder_oom 0\noom_kill 0\n",
        ),
    ] {
        fs::write(directory.join(name), value)?;
    }
    let cgroup = ChildCgroup::open_fixture(CgroupHierarchy::V1, directory.clone(), 201_326_592)?;
    Ok((temporary, cgroup, directory))
}

async fn held_child(cgroup: ChildCgroup) -> io::Result<(RecoverableChild, ChildStdin)> {
    let process = Command::new("/bin/sh")
        .arg("-c")
        .arg("trap '' TERM; printf ready; read value")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .process_group(0)
        .spawn()?;
    let mut child = RecoverableChild::new(process, cgroup).map_err(io::Error::other)?;
    let input = child
        .take_stdin()
        .ok_or_else(|| io::Error::other("fixture input pipe is absent"))?;
    let mut output = child
        .take_stdout()
        .ok_or_else(|| io::Error::other("fixture output pipe is absent"))?;
    let mut ready = [0_u8; 5];
    output.read_exact(&mut ready).await?;
    if &ready != b"ready" {
        return Err(io::Error::other("fixture did not install its TERM handler"));
    }
    Ok((child, input))
}

fn assert_reaped(process_id: u32) -> TestResult {
    let process_id = i32::try_from(process_id)?;
    let mut status = 0;
    // SAFETY: process_id is a checked positive PID created by this test, and status is a writable
    // integer. A second wait must report ECHILD after the production cleanup reaped the child.
    let result = unsafe { libc::waitpid(process_id, &raw mut status, libc::WNOHANG) };
    if result != -1 || io::Error::last_os_error().raw_os_error() != Some(libc::ECHILD) {
        return Err(io::Error::other("a completed execution must leave no waitable child").into());
    }
    Ok(())
}

#[expect(
    clippy::panic,
    reason = "the fixture verifies the business-future unwind boundary"
)]
fn fixture_panic() -> ! {
    panic!("owned attempt fixture panic")
}

#[tokio::test]
async fn panic_signals_stop_and_cleanup_survives_cancelled_completion() -> TestResult {
    let (_temporary, cgroup, _directory) = fixture()?;
    let (stop, mut stopped) = watch::channel(false);
    let (started, startup) = oneshot::channel();
    let mut execution = ExecutionHandle::spawn(stop, CLEANUP_GRACE, async move {
        let (child, input) = held_child(cgroup).await?;
        let pid = child.process_id();
        started
            .send((pid, input))
            .map_err(|_closed| io::Error::other("fixture receiver closed"))?;
        fixture_panic();
        #[expect(unreachable_code, reason = "fixes the fixture future output type")]
        Ok::<(), io::Error>(())
    });
    let (process_id, input) = startup.await?;
    time::timeout(CLEANUP_GRACE, stopped.changed()).await??;
    if !*stopped.borrow() || execution.cleanup_state() != CleanupState::Pending {
        return Err(
            io::Error::other("panic must request stop and retain cleanup ownership").into(),
        );
    }
    {
        let completion = execution.completed();
        tokio::pin!(completion);
        tokio::select! {
            biased;
            result = &mut completion => {
                return Err(io::Error::other(format!("held child cleaned before release: {result:?}")).into());
            }
            () = future::ready(()) => {}
        }
    }
    // This closes the input after the first cleanup future was cancelled. The same owned Child
    // must still be present when completed() is polled again.
    drop(input);
    if !matches!(execution.completed().await, Err(ExecutionError::Panic))
        || execution.cleanup_state() != CleanupState::Clean
    {
        return Err(io::Error::other("cancelled completion lost panic or verified cleanup").into());
    }
    assert_reaped(process_id)
}

#[tokio::test]
async fn abort_reclaims_the_business_child_and_its_io_task() -> TestResult {
    let (_temporary, cgroup, _directory) = fixture()?;
    let (stop, stopped) = watch::channel(false);
    let (started, startup) = oneshot::channel();
    let (io_dropped, io_finished) = oneshot::channel();
    let mut execution = ExecutionHandle::spawn(stop, CLEANUP_GRACE, async move {
        let (child, input) = held_child(cgroup).await?;
        let process_id = child.process_id();
        let signal = DropSignal(Some(io_dropped));
        let writer = spawn_child_io(async move {
            let _owned_input = input;
            let _signal = signal;
            future::pending::<()>().await;
        });
        started
            .send(process_id)
            .map_err(|_closed| io::Error::other("fixture receiver closed"))?;
        future::pending::<()>().await;
        drop(writer);
        drop(child);
        Ok::<(), io::Error>(())
    });
    let process_id = startup.await?;
    execution
        .abort_and_cleanup(Instant::now() + CLEANUP_GRACE)
        .await?;
    if !*stopped.borrow() {
        return Err(io::Error::other("forced cleanup must request common stop").into());
    }
    io_finished.await?;
    if execution.cleanup_state() != CleanupState::Clean
        || !matches!(execution.completed().await, Err(ExecutionError::Task(_)))
    {
        return Err(
            io::Error::other("aborted execution lost task failure or verified cleanup").into(),
        );
    }
    assert_reaped(process_id)
}

struct DropSignal(Option<oneshot::Sender<()>>);

impl Drop for DropSignal {
    fn drop(&mut self) {
        if let Some(signal) = self.0.take() {
            let _result = signal.send(());
        }
    }
}

#[tokio::test]
async fn verified_old_execution_cannot_signal_a_later_child() -> TestResult {
    let (_temporary, cgroup, directory) = fixture()?;
    let (stop, stopped) = watch::channel(false);
    let mut execution = ExecutionHandle::spawn(stop, CLEANUP_GRACE, async move {
        let child = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .kill_on_drop(true)
            .process_group(0)
            .spawn()?;
        let mut child = RecoverableChild::new(child, cgroup).map_err(io::Error::other)?;
        child.wait().await?;
        child.verify_cleanup().map_err(io::Error::other)?;
        Ok::<_, io::Error>(child.process_id())
    });
    let first_pid = execution.completed().await??;
    if execution.cleanup_state() != CleanupState::Clean || *stopped.borrow() {
        return Err(io::Error::other("verified completion must not request shutdown").into());
    }
    assert_reaped(first_pid)?;

    let mut next = Command::new("/bin/cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0)
        .spawn()?;
    let next_pid = next
        .id()
        .ok_or_else(|| io::Error::other("fixture PID is absent"))?;
    // A stale cgroup-wide emergency capability would now kill this distinct, live child.
    fs::write(directory.join("cgroup.procs"), next_pid.to_string())?;
    execution.emergency_stop()?;
    let mut input = next
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("fixture input pipe is absent"))?;
    let mut output = next
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("fixture output pipe is absent"))?;
    input.write_all(b"alive").await?;
    let mut reply = [0_u8; 5];
    time::timeout(CLEANUP_GRACE, output.read_exact(&mut reply)).await??;
    if &reply != b"alive" {
        return Err(io::Error::other("old execution must not stop a later attempt").into());
    }
    drop(input);
    next.wait().await?;
    fs::write(directory.join("cgroup.procs"), "")?;
    Ok(())
}

#[tokio::test]
async fn cleanup_failure_does_not_hide_the_original_panic() -> TestResult {
    let (_temporary, cgroup, directory) = fixture()?;
    let (stop, _stopped) = watch::channel(false);
    let (started, startup) = oneshot::channel();
    let mut execution = ExecutionHandle::spawn(stop, CLEANUP_GRACE, async move {
        let (child, input) = held_child(cgroup).await?;
        started
            .send(child.process_id())
            .map_err(|_closed| io::Error::other("fixture receiver closed"))?;
        drop(input);
        fs::remove_file(directory.join("cgroup.procs"))?;
        fixture_panic();
        #[expect(unreachable_code, reason = "fixes the fixture future output type")]
        Ok::<(), io::Error>(())
    });
    let process_id = startup.await?;
    if !matches!(execution.completed().await, Err(ExecutionError::Panic))
        || !matches!(execution.cleanup_state(), CleanupState::Failed { .. })
    {
        return Err(io::Error::other("cleanup failure must preserve the original panic").into());
    }
    assert_reaped(process_id)
}

#[tokio::test]
async fn normal_domain_error_keeps_its_typed_resources() -> TestResult {
    let (stop, stopped) = watch::channel(false);
    let mut execution = ExecutionHandle::spawn(stop, CLEANUP_GRACE, async {
        (
            String::from("reusable resources"),
            Err::<(), _>("domain failure"),
        )
    });
    let (resources, result) = execution.completed().await?;
    if resources != "reusable resources"
        || result != Err("domain failure")
        || execution.cleanup_state() != CleanupState::Clean
        || *stopped.borrow()
    {
        return Err(io::Error::other(
            "completion must retain typed resources and domain failure policy",
        )
        .into());
    }
    Ok(())
}
