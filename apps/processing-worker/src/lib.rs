//! Background processing runtime for the series-analysis and OCR capabilities.
//!
//! The `momo-analysis-core` crate owns calculation semantics and wire contracts. This crate owns
//! their side effects: job coordination, process isolation, bounded storage, release tooling, and
//! runtime configuration.

#[path = "orchestrator/analysis/mod.rs"]
mod analysis;
mod artifact;
mod cgroup;
pub mod child;
mod child_report;
mod cli;
pub mod config;
mod control;
mod database;
mod execution_slot;
#[path = "orchestrator/ocr/mod.rs"]
pub mod ocr;
pub mod orchestrator;
#[expect(
    unsafe_code,
    reason = "all operating-system FFI is isolated here behind checked safe APIs and documented blocks"
)]
pub mod process;
pub mod release;
pub mod shadow;

pub use analysis::WorkerError;
pub use cli::entrypoint;

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "architecture-test discovery failures must identify the unreadable source path"
)]
mod architecture_tests;
