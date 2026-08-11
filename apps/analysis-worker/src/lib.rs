//! Runtime shell for the deterministic series-analysis kernel.
//!
//! The `momo-analysis-core` crate owns calculation semantics and wire contracts. This crate owns
//! side effects: process isolation, `PostgreSQL` and `Redis` coordination, bounded artifact
//! staging, release tooling, and runtime configuration.

mod artifact;
pub mod child;
mod child_report;
pub mod config;
mod control;
mod database;
mod execution_slot;
pub mod ocr;
#[expect(
    unsafe_code,
    reason = "all operating-system FFI is isolated here behind checked safe APIs and documented blocks"
)]
pub mod process;
pub mod release;
pub mod shadow;
pub mod worker;

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "architecture-test discovery failures must identify the unreadable source path"
)]
mod architecture_tests;
