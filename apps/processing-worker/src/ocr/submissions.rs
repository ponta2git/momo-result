//! Submission completion is independent of image execution and of notification delivery.

use std::time::Duration;

pub(crate) mod control;
pub(crate) mod runtime;

pub(super) const PAGE_SIZE: i64 = 32;
pub(super) const SAFETY_INTERVAL: Duration = Duration::from_secs(30);
