//! OCR runtime boundaries shared by the queue consumer, object store, and isolated OCR child.

pub mod contract;
pub(crate) mod control;
pub mod object_store;
pub(crate) mod queue;
pub mod worker;
