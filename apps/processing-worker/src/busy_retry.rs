//! Small, consumer-owned budgets for optional early rechecks of busy work.
//!
//! Ordinary delivery and recovery remain responsible for progress after this budget is spent.
//! Keep the budget across deliveries and reconnects; only an actual extra DB attempt spends it.

use std::time::Duration;

use tokio::time::Instant;

const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];
const START_WINDOW: Duration = Duration::from_secs(10);

pub(crate) struct BusyRetryBudget {
    period: Duration,
    starts: [Option<Instant>; 3],
}

impl BusyRetryBudget {
    pub(crate) const fn new(period: Duration) -> Self {
        Self {
            period,
            starts: [None; 3],
        }
    }

    pub(crate) fn try_start(&mut self, now: Instant) -> bool {
        let Some(slot) = self.starts.iter_mut().find(|started| {
            started.is_none_or(|started| now.saturating_duration_since(started) >= self.period)
        }) else {
            return false;
        };
        *slot = Some(now);
        true
    }

    pub(crate) fn available(&self, now: Instant) -> bool {
        self.starts.iter().any(|started| {
            started.is_none_or(|started| now.saturating_duration_since(started) >= self.period)
        })
    }
}

pub(crate) struct BusyRetry {
    deadline: Instant,
    attempts: u8,
}

impl BusyRetry {
    pub(crate) fn new(busy_at: Instant, normal_recovery_at: Instant) -> Self {
        Self {
            deadline: (busy_at + START_WINDOW).min(normal_recovery_at),
            attempts: 0,
        }
    }

    pub(crate) fn next_at(&self, now: Instant) -> Option<Instant> {
        let next = now + *RETRY_DELAYS.get(usize::from(self.attempts))?;
        (next < self.deadline).then_some(next)
    }

    pub(crate) fn try_start(&mut self, now: Instant, budget: &mut BusyRetryBudget) -> bool {
        if now >= self.deadline
            || usize::from(self.attempts) >= RETRY_DELAYS.len()
            || !budget.try_start(now)
        {
            return false;
        }
        self.attempts += 1;
        true
    }

    pub(crate) const fn attempts(&self) -> u8 {
        self.attempts
    }
}

#[cfg(test)]
mod tests {
    use super::{BusyRetry, BusyRetryBudget};
    use std::time::Duration;
    use tokio::time::Instant;

    #[test]
    fn different_jobs_share_a_rolling_budget_without_boundary_bursts() {
        let start = Instant::now();
        let period = Duration::from_secs(70);
        let mut budget = BusyRetryBudget::new(period);
        for seconds in [0, 1, 2] {
            let now = start + Duration::from_secs(seconds);
            let mut job = BusyRetry::new(now, now + period);
            assert!(
                job.try_start(now, &mut budget),
                "initial budget is available"
            );
        }
        let mut next_job = BusyRetry::new(start + period, start + period * 2);
        assert!(
            !budget.available(start + Duration::from_secs(69)),
            "new work cannot reset the shared budget"
        );
        assert!(
            next_job.try_start(start + period, &mut budget),
            "one slot expires"
        );
        assert!(
            !next_job.try_start(start + period, &mut budget),
            "the other two starts remain inside the rolling window"
        );
        assert!(
            next_job.try_start(start + period + Duration::from_secs(1), &mut budget),
            "the second slot expires independently"
        );
    }

    #[test]
    fn rechecks_back_off_and_expire_without_postponing_normal_recovery() {
        let start = Instant::now();
        let mut budget = BusyRetryBudget::new(Duration::from_secs(30));
        let mut retry = BusyRetry::new(start, start + Duration::from_secs(30));
        let mut now = start;
        for delay in [1, 2, 4] {
            now += Duration::from_secs(delay);
            assert_eq!(
                retry.next_at(now - Duration::from_secs(delay)),
                Some(now),
                "the next delay backs off"
            );
            assert!(retry.try_start(now, &mut budget), "bounded retry may start");
        }
        assert_eq!(
            retry.attempts(),
            3,
            "only three additional attempts are admitted"
        );
        assert_eq!(retry.next_at(now), None, "the episode cannot retry forever");

        let early_recovery = start + Duration::from_secs(2);
        let early = BusyRetry::new(start, early_recovery);
        assert_eq!(
            early.next_at(start + Duration::from_secs(1)),
            None,
            "normal recovery takes priority at its original deadline"
        );
        let mut expired = BusyRetry::new(start, start + Duration::from_secs(30));
        let mut fresh_budget = BusyRetryBudget::new(Duration::from_secs(30));
        assert!(
            !expired.try_start(start + Duration::from_secs(10), &mut fresh_budget),
            "a delayed timer cannot start work past the episode deadline"
        );
        assert!(
            fresh_budget.try_start(start),
            "expired episodes spend no budget"
        );
    }
}
