use std::{error::Error, fs, io, os::unix::net::UnixStream, process::Stdio, time::Duration};

use tokio::process::{ChildStdin, Command};

use super::{AnalysisChildOutcome, ManagedAnalysisChild, ProcessError};
use crate::cgroup::{CGROUP_DIRECTORY_NAME, CgroupHierarchy, ChildCgroup};

#[tokio::test]
async fn closed_liveness_channel_waits_for_actual_child_exit() -> Result<(), Box<dyn Error>> {
    let (_directory, mut child, input) = child_with_closed_liveness()?;
    if child.try_wait()?.is_some() {
        return Err(io::Error::other("fixture child exited before its input was released").into());
    }

    let outcome = {
        let refresh = child.refresh_liveness(Duration::from_secs(5));
        tokio::pin!(refresh);
        // Poll the real socket failure while the child is held alive by its input pipe. The old
        // immediate try_wait fallback returned a failure here, before a successful exit was ready.
        tokio::select! {
            biased;
            result = &mut refresh => {
                return Err(io::Error::other(format!("refresh resolved before child exit: {result:?}")).into());
            }
            () = std::future::ready(()) => {}
        }
        drop(input);
        refresh.await?
    };
    if outcome != Some(AnalysisChildOutcome::Succeeded) || child.try_wait()? != outcome {
        return Err(io::Error::other("closed channel lost the child's successful exit").into());
    }
    Ok(())
}

#[tokio::test]
async fn closed_liveness_channel_remains_bounded_and_allows_verified_cleanup()
-> Result<(), Box<dyn Error>> {
    let (_directory, mut child, _input) = child_with_closed_liveness()?;
    let error = child
        .refresh_liveness(Duration::from_millis(1))
        .await
        .err()
        .ok_or_else(|| io::Error::other("a live child with a closed channel must fail"))?;
    if !matches!(error, ProcessError::Liveness(_)) || child.try_wait()?.is_some() {
        return Err(
            io::Error::other("closed channel must time out while the child is alive").into(),
        );
    }
    let _status = child.terminate(Duration::from_secs(5)).await?;
    if child.child.try_wait()?.is_none() {
        return Err(io::Error::other("timed out liveness wait prevented child cleanup").into());
    }
    child.cgroup.ensure_empty()?;
    Ok(())
}

fn child_with_closed_liveness()
-> Result<(tempfile::TempDir, ManagedAnalysisChild, ChildStdin), Box<dyn Error>> {
    let temporary = tempfile::tempdir()?;
    let directory = temporary.path().join(CGROUP_DIRECTORY_NAME);
    fs::create_dir(&directory)?;
    // These controller files isolate the socket/exit race. Actual cgroup membership and hard
    // limits remain the production image smoke's oracle; this fixture uses a real Unix child.
    for (name, value) in [
        ("cgroup.procs", ""),
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
    let cgroup = ChildCgroup::open_fixture(CgroupHierarchy::V1, directory, 201_326_592)?;
    let (parent_liveness, peer) = UnixStream::pair()?;
    parent_liveness.set_nonblocking(true)?;
    drop(peer);
    let mut child = Command::new("/bin/cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .process_group(0)
        .spawn()?;
    let process_id = child
        .id()
        .ok_or_else(|| io::Error::other("fixture child has no process id"))?;
    let input = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("fixture child has no input pipe"))?;
    Ok((
        temporary,
        ManagedAnalysisChild {
            child,
            process_id,
            peak_resident_bytes: None,
            cgroup,
            oom_kill_count_before: 0,
            parent_liveness,
        },
        input,
    ))
}
