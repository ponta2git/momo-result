//! Background processing runtime for the series-analysis and OCR capabilities.
//!
//! The `momo-analysis-core` crate owns calculation semantics and wire contracts. This crate owns
//! their side effects: job coordination, process isolation, bounded storage, release tooling, and
//! runtime configuration.

mod artifact;
mod cgroup;
pub mod child;
mod child_report;
mod cli;
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
mod series_analysis;
pub mod shadow;
pub mod supervisor;

pub use cli::entrypoint;

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "architecture-test discovery failures must identify the unreadable source path"
)]
mod architecture_tests;
