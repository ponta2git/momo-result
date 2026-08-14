//! Durable OCR processing around the isolated `momo-ocr` capability.

pub(crate) mod child;
mod child_launcher;
#[cfg_attr(
    not(target_os = "linux"),
    expect(
        dead_code,
        reason = "the non-Linux build retains consumer policy tests while execution is Linux-only"
    )
)]
pub(crate) mod consumer;
pub(crate) mod contract;
#[cfg_attr(
    not(target_os = "linux"),
    expect(
        dead_code,
        reason = "the non-Linux build retains control-plane tests while execution is Linux-only"
    )
)]
pub(crate) mod control;
#[cfg_attr(
    not(target_os = "linux"),
    expect(
        dead_code,
        reason = "the non-Linux build retains endurance validators while execution is Linux-only"
    )
)]
pub(crate) mod endurance;
#[cfg_attr(
    not(target_os = "linux"),
    expect(
        dead_code,
        reason = "the non-Linux build retains object-store validation tests while downloads are Linux-only"
    )
)]
pub(crate) mod object_store;
#[cfg_attr(
    not(target_os = "linux"),
    expect(
        dead_code,
        reason = "the non-Linux build retains queue contract tests while consumption is Linux-only"
    )
)]
pub(crate) mod queue;
mod runtime_config;

pub(crate) use child_launcher::probe_isolated_child_lifecycle;
#[cfg(target_os = "linux")]
pub(crate) use child_launcher::{IsolatedOcrChildLauncher, analyze_isolated_local_image_bytes};
pub(crate) use runtime_config::OcrRuntimeConfigError;
pub(crate) use runtime_config::{
    OcrConsumerMode, OcrConsumerRuntimeConfig, consumer_mode_from_environment,
};
