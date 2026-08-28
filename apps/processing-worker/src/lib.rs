//! Background processing runtime for the series-analysis and OCR capabilities.
//!
//! The `momo-analysis-core` crate owns calculation semantics and wire contracts. This crate owns
//! their side effects: job coordination, process isolation, bounded storage, release tooling, and
//! runtime configuration. Its only public Rust entry point is [`entrypoint`]; capability and
//! infrastructure modules stay private so deployment commands cannot bypass the CLI boundary.

mod cgroup;
mod cli;
mod execution_slot;
mod ocr;
mod outbox;
mod pel_recovery;
mod postgres;
#[expect(
    unsafe_code,
    reason = "all operating-system FFI is isolated here behind checked safe APIs and documented blocks"
)]
mod process;
mod runtime_identifier;
mod series_analysis;
mod supervisor;

pub use cli::entrypoint;
