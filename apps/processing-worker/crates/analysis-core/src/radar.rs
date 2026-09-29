//! Fixed, title-wide player-radar criteria and deterministic scoring.
//!
//! This module deliberately owns no clock, database identity, or application history. A stored
//! basis is a calculation input; preparing a candidate never changes the currently applied one.

mod calculation;
mod monitoring;
mod snapshot;
mod types;

pub use calculation::{
    evaluate_rows, evaluate_scope, evaluate_scopes, generate_candidate, score_value, validate_basis,
};
pub use monitoring::monitor;
pub use snapshot::{snapshot, source_is_current};
pub use types::*;

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "radar calculation fixtures must satisfy the production input contract"
)]
mod tests;
