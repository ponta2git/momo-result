//! Business notification content and recoverable preparation inside the worker transaction.

pub(crate) mod analysis;
pub(crate) mod ocr;
mod preparation;

pub(crate) use momo_notifications::{
    NotificationConfig, NotificationConfigError, NotificationDriver, NotificationEnvelope,
    NotificationKind, NotificationRejection, NotificationReservation, NotificationSink,
    PreparedNotification,
};

pub(crate) fn config_from_environment() -> Result<NotificationConfig, NotificationConfigError> {
    use std::env;

    match env::var("RESULT_NOTIFICATIONS_MODE").as_deref() {
        Ok("disabled") | Err(env::VarError::NotPresent) => Ok(NotificationConfig::disabled()),
        Ok("http") => NotificationConfig::http(
            &env::var("RESULT_NOTIFICATIONS_URL").map_err(|_error| NotificationConfigError)?,
            &env::var("RESULT_NOTIFICATIONS_BEARER_TOKEN")
                .map_err(|_error| NotificationConfigError)?,
        ),
        Ok(_) | Err(env::VarError::NotUnicode(_)) => Err(NotificationConfigError),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SkipReason {
    TransportDisabled,
    SenderClosed,
    Capacity,
    PayloadBound,
    InvalidSnapshot,
    MissingBaseline,
    NoMatchMutation,
    NoInputChanges,
    SettingOff,
    ComparisonTimeout,
    FinalizationBudget,
    PreparationTimeout,
    PreparationFailed,
}

impl From<NotificationRejection> for SkipReason {
    fn from(reason: NotificationRejection) -> Self {
        match reason {
            NotificationRejection::TransportDisabled => Self::TransportDisabled,
            NotificationRejection::SenderClosed => Self::SenderClosed,
            NotificationRejection::Capacity => Self::Capacity,
            NotificationRejection::PayloadBound => Self::PayloadBound,
            NotificationRejection::InvalidEnvelope => Self::InvalidSnapshot,
        }
    }
}

pub(crate) fn log_skip(kind: &'static str, job_id: &str, reason: SkipReason) {
    tracing::info!(event = "result_notification_skipped", kind, source_job_id = job_id, reason = ?reason);
}

#[cfg(test)]
mod bounds_tests;
#[cfg(test)]
pub(crate) mod test_support;
