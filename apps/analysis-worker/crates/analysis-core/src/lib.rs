//! Deterministic, side-effect-free series-analysis kernel.
//!
//! This crate owns calculation semantics and versioned artifact contracts. Runtime concerns such
//! as `PostgreSQL`, `Redis`, processes, environment variables, clocks, and filesystems belong to the
//! outer `momo-analysis` crate. Keeping this boundary free of runtime infrastructure makes
//! calculation changes reusable, locally testable, and impossible to couple accidentally to
//! worker infrastructure.

pub mod canonical;
pub mod child;
pub mod compute;
pub mod contract;
pub mod model;
mod numeric;
pub mod payload;
mod playbook;
mod rank;
mod rankings;
mod stats;

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "architecture-test discovery failures must identify the unreadable source path"
)]
mod architecture_tests;

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "fixture setup must abort immediately with a precise message when checked-in vectors drift"
)]
mod fixture;
