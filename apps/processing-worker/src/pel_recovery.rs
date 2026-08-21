//! Bounded scheduling for Redis Streams pending-entry recovery.
//!
//! The queue adapters own Redis commands and cursors. This module owns only the deterministic
//! decision of when one recovery command may run, so an empty queue cannot turn recovery into a
//! short-period poll.

use std::time::{Duration, Instant};

const MAXIMUM_COLD_PAGES_PER_SWEEP: usize = 100;
const MAXIMUM_TRACKED_TARGETS: usize = 100;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RecoveryAction {
    ColdPage,
    Targeted(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecoveryActionKind {
    ColdPage,
    Targeted,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Target {
    message_id: String,
    due_at: Instant,
}

/// Schedules bounded PEL recovery around the normal `XREADGROUP ... > BLOCK` path.
///
/// A recovery action is allowed at startup, then only after the consumer has issued one new-entry
/// read. A cold sweep is resumed one page at a time, while known local PEL entries can receive one
/// target-time recovery at their existing Redis idle threshold.
#[derive(Debug)]
pub(crate) struct PelRecoverySchedule {
    cold_interval: Duration,
    next_cold_at: Instant,
    cold_sweep_active: bool,
    cold_sweep_pages: usize,
    recovery_allowed: bool,
    last_action: Option<RecoveryActionKind>,
    targets: Vec<Target>,
}

impl PelRecoverySchedule {
    #[must_use]
    pub(crate) const fn new(now: Instant, cold_interval: Duration) -> Self {
        Self {
            cold_interval,
            next_cold_at: now,
            cold_sweep_active: false,
            cold_sweep_pages: 0,
            recovery_allowed: true,
            last_action: None,
            targets: Vec::new(),
        }
    }

    /// Returns at most one due recovery action.
    #[must_use]
    pub(crate) fn due_action(&self, now: Instant) -> Option<RecoveryAction> {
        if !self.recovery_allowed {
            return None;
        }
        let target = self.due_target(now);
        let cold_due = self.cold_sweep_active || now >= self.next_cold_at;
        match (target, cold_due) {
            (Some(target), true) if self.last_action != Some(RecoveryActionKind::Targeted) => {
                Some(RecoveryAction::Targeted(target.message_id.clone()))
            }
            (_, true) => Some(RecoveryAction::ColdPage),
            (Some(target), false) => Some(RecoveryAction::Targeted(target.message_id.clone())),
            (None, false) => None,
        }
    }

    /// Records that one `XREADGROUP ... >` request has completed, even if it returned a delivery.
    pub(crate) const fn record_new_delivery_read(&mut self) {
        self.recovery_allowed = true;
    }

    /// Removes a target when that PEL entry is observed as a delivery again.
    pub(crate) fn forget_target(&mut self, message_id: &str) {
        self.targets
            .retain(|target| target.message_id != message_id);
    }

    /// Schedules one direct recovery for a known PEL entry.
    ///
    /// Returns `false` if the bounded local target set is full. The entry remains durable in the
    /// PEL and will be handled by the cold sweep instead.
    pub(crate) fn schedule_target(&mut self, message_id: String, due_at: Instant) -> bool {
        if let Some(target) = self
            .targets
            .iter_mut()
            .find(|target| target.message_id == message_id)
        {
            target.due_at = due_at;
            return true;
        }
        if self.targets.len() >= MAXIMUM_TRACKED_TARGETS {
            return false;
        }
        self.targets.push(Target { message_id, due_at });
        true
    }

    /// Records one target recovery attempt.
    pub(crate) fn record_target_attempt(&mut self, message_id: &str) {
        self.forget_target(message_id);
        self.recovery_allowed = false;
        self.last_action = Some(RecoveryActionKind::Targeted);
    }

    /// Records one cold recovery page.
    ///
    /// Returns `false` only if advancing the next cold deadline would exceed the monotonic clock
    /// bound. Callers must fail closed rather than turn that condition into an immediate retry.
    pub(crate) fn record_cold_page(&mut self, now: Instant, complete: bool) -> bool {
        self.recovery_allowed = false;
        self.last_action = Some(RecoveryActionKind::ColdPage);
        if complete {
            self.cold_sweep_active = false;
            self.cold_sweep_pages = 0;
            return self.defer_cold_until(now);
        }
        self.cold_sweep_pages = self.cold_sweep_pages.saturating_add(1);
        if self.cold_sweep_pages >= MAXIMUM_COLD_PAGES_PER_SWEEP {
            self.cold_sweep_active = false;
            self.cold_sweep_pages = 0;
            return self.defer_cold_until(now);
        }
        self.cold_sweep_active = true;
        true
    }

    fn due_target(&self, now: Instant) -> Option<&Target> {
        self.targets
            .iter()
            .filter(|target| target.due_at <= now)
            .min_by(|left, right| {
                left.due_at
                    .cmp(&right.due_at)
                    .then_with(|| left.message_id.cmp(&right.message_id))
            })
    }

    fn defer_cold_until(&mut self, now: Instant) -> bool {
        let Some(next_cold_at) = now.checked_add(self.cold_interval) else {
            return false;
        };
        self.next_cold_at = next_cold_at;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLD_INTERVAL: Duration = Duration::from_mins(5);

    #[test]
    fn startup_runs_one_cold_page_then_waits_for_the_normal_read_and_interval() {
        let now = Instant::now();
        let mut schedule = PelRecoverySchedule::new(now, COLD_INTERVAL);

        assert_eq!(schedule.due_action(now), Some(RecoveryAction::ColdPage));
        assert!(schedule.record_cold_page(now, true));
        assert_eq!(schedule.due_action(now), None);

        schedule.record_new_delivery_read();
        assert_eq!(
            schedule.due_action(now + Duration::from_secs(299)),
            None,
            "a completed sweep must not become an empty-queue poll"
        );
        assert_eq!(
            schedule.due_action(now + COLD_INTERVAL),
            Some(RecoveryAction::ColdPage)
        );
    }

    #[test]
    fn incomplete_cold_sweep_requires_a_new_entry_read_between_pages() {
        let now = Instant::now();
        let mut schedule = PelRecoverySchedule::new(now, COLD_INTERVAL);

        assert!(schedule.record_cold_page(now, false));
        assert_eq!(schedule.due_action(now), None);

        schedule.record_new_delivery_read();
        assert_eq!(schedule.due_action(now), Some(RecoveryAction::ColdPage));
    }

    #[test]
    fn target_is_not_due_before_its_idle_threshold_and_is_removed_after_attempt() {
        let now = Instant::now();
        let mut schedule = PelRecoverySchedule::new(now, COLD_INTERVAL);
        assert!(schedule.record_cold_page(now, true));
        schedule.record_new_delivery_read();

        let due_at = now + Duration::from_mins(2);
        assert!(schedule.schedule_target(String::from("42-0"), due_at));
        assert_eq!(schedule.due_action(now + Duration::from_mins(1)), None);
        assert_eq!(
            schedule.due_action(due_at),
            Some(RecoveryAction::Targeted(String::from("42-0")))
        );

        schedule.record_target_attempt("42-0");
        assert_eq!(schedule.due_action(due_at), None);
        schedule.record_new_delivery_read();
        assert_eq!(schedule.due_action(due_at), None);
    }

    #[test]
    fn due_target_and_cold_page_alternate_without_starving_each_other() {
        let now = Instant::now();
        let mut schedule = PelRecoverySchedule::new(now, COLD_INTERVAL);
        assert!(schedule.schedule_target(String::from("42-0"), now));

        assert_eq!(
            schedule.due_action(now),
            Some(RecoveryAction::Targeted(String::from("42-0")))
        );
        schedule.record_target_attempt("42-0");
        schedule.record_new_delivery_read();
        assert_eq!(schedule.due_action(now), Some(RecoveryAction::ColdPage));
    }

    #[test]
    fn tracked_targets_are_bounded_and_overflow_falls_back_to_cold_recovery() {
        let now = Instant::now();
        let mut schedule = PelRecoverySchedule::new(now, COLD_INTERVAL);
        for index in 0..MAXIMUM_TRACKED_TARGETS {
            assert!(schedule.schedule_target(format!("{index}-0"), now));
        }
        assert!(
            !schedule.schedule_target(String::from("overflow-0"), now),
            "the local schedule must not grow with an unbounded PEL"
        );
        assert_eq!(schedule.targets.len(), MAXIMUM_TRACKED_TARGETS);
    }

    #[test]
    fn incomplete_sweep_is_capped_before_it_can_monopolize_the_idle_loop() {
        let now = Instant::now();
        let mut schedule = PelRecoverySchedule::new(now, COLD_INTERVAL);

        for page in 0..MAXIMUM_COLD_PAGES_PER_SWEEP {
            assert_eq!(schedule.due_action(now), Some(RecoveryAction::ColdPage));
            assert!(schedule.record_cold_page(now, false));
            if page + 1 < MAXIMUM_COLD_PAGES_PER_SWEEP {
                schedule.record_new_delivery_read();
            }
        }
        assert_eq!(schedule.due_action(now), None);

        schedule.record_new_delivery_read();
        assert_eq!(schedule.due_action(now), None);
        assert_eq!(
            schedule.due_action(now + COLD_INTERVAL),
            Some(RecoveryAction::ColdPage)
        );
    }
}
