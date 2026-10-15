//! Background processing runtime for the series-analysis and OCR capabilities.
//!
//! The `momo-analysis-core` and `momo-ocr` crates own capability semantics and wire contracts. This
//! crate owns their side effects: job coordination, process isolation, bounded storage, release
//! tooling, and runtime configuration. It prepares notification content and owns database connections,
//! commit, and sender supervision; `momo-notifications` owns bounded admission, wire encoding, final
//! size checks, transport validation, and HTTP delivery. Its only public Rust entry point is
//! [`entrypoint`]; capability and infrastructure modules stay private so deployment commands cannot
//! bypass the CLI boundary.

mod blocking;
mod busy_retry;
mod cgroup;
mod cli;
mod execution;
mod execution_slot;
mod notifications;
mod ocr;
mod postgres;
#[expect(
    unsafe_code,
    reason = "all operating-system FFI is isolated here behind checked safe APIs and documented blocks"
)]
mod process;
mod runtime_identifier;
mod series_analysis;
mod worker;

pub use cli::entrypoint;
