//! Keeps a process wait handle recoverable after its owning business future unwinds.

use std::{io, process::ExitStatus};

use tokio::{
    process::{Child, ChildStdin, ChildStdout},
    time::Instant,
};

use super::{ChildStopDeadlines, ProcessError};
use crate::{
    cgroup::ChildCgroup,
    execution::{ChildRegistration, register_child},
};

/// The capability is scoped to one attempt and retired only after verified cleanup. It is not
/// reconstructed from a worker-wide cgroup path when an old execution is asked to stop.
#[derive(Clone)]
pub(crate) struct EmergencyChild {
    process_id: u32,
    cgroup: ChildCgroup,
}

impl EmergencyChild {
    #[cfg(unix)]
    pub(crate) fn stop(&self) -> Result<(), ProcessError> {
        let group = super::terminate_process_group(self.process_id, libc::SIGKILL);
        let cgroup = self.cgroup.hard_kill().map_err(ProcessError::from);
        group.and_then(|()| cgroup.map(|_observed| ()))
    }

    #[cfg(not(unix))]
    pub(crate) fn stop(&self) -> Result<(), ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }
}

/// Wrap immediately after spawn, before cgroup attachment, pipe setup, or any await. Within an
/// execution scope, Drop transfers the wait handle to its cancellation-safe recovery owner.
/// Standalone process probes retain the existing synchronous fail-closed Drop fallback.
pub(crate) struct RecoverableChild {
    child: Option<Child>,
    emergency: EmergencyChild,
    registration: Option<ChildRegistration>,
    verified: bool,
}

impl RecoverableChild {
    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production child creation occurs in the Linux adapter"
        )
    )]
    pub(crate) fn new(child: Child, cgroup: ChildCgroup) -> Result<Self, ProcessError> {
        let process_id = child.id().ok_or(ProcessError::MissingProcessId)?;
        let emergency = EmergencyChild { process_id, cgroup };
        // Construct the guard before attempting registration. A conflicting registration must
        // still close and stop the process that was just spawned.
        let mut owned = Self {
            child: Some(child),
            emergency,
            registration: None,
            verified: false,
        };
        owned.registration = register_child(owned.emergency.clone())?;
        Ok(owned)
    }

    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production child creation occurs in the Linux adapter"
        )
    )]
    pub(crate) const fn process_id(&self) -> u32 {
        self.emergency.process_id
    }

    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production child pipe setup occurs in the Linux adapter"
        )
    )]
    pub(crate) fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.child.as_mut().and_then(|child| child.stdin.take())
    }

    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "only the Linux OCR adapter reads the child output pipe"
        )
    )]
    pub(crate) fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.as_mut().and_then(|child| child.stdout.take())
    }

    pub(crate) async fn wait(&mut self) -> io::Result<ExitStatus> {
        match self.child.as_mut() {
            Some(child) => child.wait().await,
            None => Err(io::Error::other("managed child was already released")),
        }
    }

    pub(crate) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.as_mut().map_or_else(
            || Err(io::Error::other("managed child was already released")),
            Child::try_wait,
        )
    }

    #[cfg(unix)]
    pub(crate) async fn stop_and_reap(
        &mut self,
        deadlines: ChildStopDeadlines,
    ) -> Result<ExitStatus, ProcessError> {
        let child = self
            .child
            .as_mut()
            .ok_or(ProcessError::ChildCleanupOwnership)?;
        super::stop_and_reap_child(child, self.emergency.process_id, deadlines).await
    }

    /// Verification, rather than a task's successful return, retires its emergency capability.
    pub(crate) fn verify_cleanup(&mut self) -> Result<(), ProcessError> {
        if self.try_wait().map_err(ProcessError::Wait)?.is_none() {
            return Err(ProcessError::ChildCleanupOwnership);
        }
        self.emergency.cgroup.ensure_empty()?;
        self.verified = true;
        if let Some(registration) = &self.registration {
            registration.verified();
        }
        Ok(())
    }
}

impl Drop for RecoverableChild {
    fn drop(&mut self) {
        let Some(child) = self.child.take() else {
            return;
        };
        if self.verified {
            drop(child);
            return;
        }
        let recovered = RecoveredChild {
            child,
            emergency: self.emergency.clone(),
            verified: false,
        };
        if let Some(registration) = self.registration.take() {
            registration.recover(recovered);
        } else {
            drop(recovered);
        }
    }
}

/// Stored in the execution scope's async owner while cleanup is polled. Cancelling the cleanup
/// future releases only its lock guard; it does not drop this child or lose the right to reap it.
pub(crate) struct RecoveredChild {
    child: Child,
    emergency: EmergencyChild,
    verified: bool,
}

impl RecoveredChild {
    #[cfg(unix)]
    pub(crate) async fn cleanup(&mut self, deadline: Instant) -> Result<(), ProcessError> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            drop(self.emergency.stop());
            return Err(ProcessError::StopTimeout);
        }
        let mut deadlines = super::child_stop_deadlines(remaining)?;
        // Rounding and the work used to construct sub-deadlines must never extend the caller's
        // existing absolute deadline.
        deadlines.soft = deadlines.soft.min(deadline);
        deadlines.reap = deadlines.reap.min(deadline);
        deadlines.overall = deadline;
        let leader =
            super::stop_and_reap_child(&mut self.child, self.emergency.process_id, deadlines).await;
        let group = super::stop_remaining_process_group(
            self.emergency.process_id,
            &self.emergency.cgroup,
            deadline,
        )
        .await;
        leader?;
        group?;
        self.verified = true;
        Ok(())
    }

    #[cfg(not(unix))]
    pub(crate) async fn cleanup(&mut self, _deadline: Instant) -> Result<(), ProcessError> {
        Err(ProcessError::UnsupportedPlatform)
    }
}

impl Drop for RecoveredChild {
    fn drop(&mut self) {
        if !self.verified {
            drop(self.emergency.stop());
        }
    }
}

#[cfg(test)]
#[cfg(unix)]
mod tests;
