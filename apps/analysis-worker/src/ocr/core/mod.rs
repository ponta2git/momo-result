//! Rust implementation of the OCR algorithm, independent from queue and persistence concerns.

mod aliases;
mod domain;
mod geometry;
mod incident;
mod incident_pipeline;
mod money;
mod pipeline;
mod player_order;
mod preprocess;
mod ranked;
mod recognition;

pub(crate) use aliases::{AliasResolver, PlayerIdentity, names_match};
pub(crate) use domain::{DraftPayload, OcrField, OcrWarning, PlayerDraft};
pub(crate) use geometry::{Rect, crop, scale_profile_rect};
pub(crate) use incident::{CountRecognition, PsmAttempt};
pub(crate) use money::{parse_money_man_yen, parse_revenue_man_yen};
pub(crate) use pipeline::{CoreOcrError, CoreOcrOutput, analyze};
pub(crate) use recognition::{RecognitionError, RecognitionSession};

#[cfg(test)]
mod characterization_tests;
