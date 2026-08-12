//! Entry adapters for the two isolated child processes.
//!
//! The adapters own process-local I/O and translate it to the capability crates. They do not own
//! queue delivery, retry, cgroup setup, or publication policy.

pub mod analysis;
pub mod ocr;

pub use analysis::{ChildComputeRequest, execute};
