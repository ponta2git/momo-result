#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AttemptOutcome {
    Succeeded,
    Failed,
    TimedOut,
    Superseded,
    Preempted,
    GracefulStop,
    OwnerLost,
}

impl AttemptOutcome {
    pub(super) const fn wire(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::TimedOut => "timed_out",
            Self::Superseded => "superseded",
            Self::Preempted => "preempted",
            Self::GracefulStop => "graceful_stop",
            Self::OwnerLost => "owner_lost",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum DeliveryReason {
    Superseded,
    TransientRetry,
    Preempted,
    GracefulStop,
    LeaseRecovery,
    FollowUp,
}

impl DeliveryReason {
    pub(super) const fn wire(self) -> &'static str {
        match self {
            Self::Superseded => "superseded",
            Self::TransientRetry => "transient-retry",
            Self::Preempted => "preempted",
            Self::GracefulStop => "graceful_stop",
            Self::LeaseRecovery => "lease-recovery",
            Self::FollowUp => "followup",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RequestOutcome {
    Succeeded,
    Failed,
}

impl RequestOutcome {
    pub(super) const fn wire(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ResultDisposition {
    Published,
    Reused,
}

impl ResultDisposition {
    pub(super) const fn wire(self) -> &'static str {
        match self {
            Self::Published => "published",
            Self::Reused => "reused",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RequeueCause {
    Preempted,
    GracefulStop,
}

impl RequeueCause {
    pub(super) const fn attempt_outcome(self) -> AttemptOutcome {
        match self {
            Self::Preempted => AttemptOutcome::Preempted,
            Self::GracefulStop => AttemptOutcome::GracefulStop,
        }
    }

    pub(super) const fn delivery_reason(self) -> DeliveryReason {
        match self {
            Self::Preempted => DeliveryReason::Preempted,
            Self::GracefulStop => DeliveryReason::GracefulStop,
        }
    }

    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::Preempted => "preempted",
            Self::GracefulStop => "graceful_stop",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SafeFailureCode {
    ArtifactTooLarge,
    ArtifactValidationFailed,
    CalculationFailed,
    DependencyRetryExhausted,
    HardTimeout,
    InputContractInvalid,
    InputRevisionViolation,
    LeaseRecoveryExhausted,
    NonDeterministicOutput,
    PublicationFailed,
    ResourceExhausted,
    TemporaryStorageExhausted,
    WorkerCrashed,
}

impl SafeFailureCode {
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Self::ArtifactTooLarge => "artifact_too_large",
            Self::ArtifactValidationFailed => "artifact_validation_failed",
            Self::CalculationFailed => "calculation_failed",
            Self::DependencyRetryExhausted => "dependency_retry_exhausted",
            Self::HardTimeout => "hard_timeout",
            Self::InputContractInvalid => "input_contract_invalid",
            Self::InputRevisionViolation => "input_revision_violation",
            Self::LeaseRecoveryExhausted => "lease_recovery_exhausted",
            Self::NonDeterministicOutput => "non_deterministic_output",
            Self::PublicationFailed => "publication_failed",
            Self::ResourceExhausted => "resource_exhausted",
            Self::TemporaryStorageExhausted => "temporary_storage_exhausted",
            Self::WorkerCrashed => "worker_crashed",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AttemptFailure {
    outcome: AttemptOutcome,
    code: SafeFailureCode,
}

impl AttemptFailure {
    #[must_use]
    pub(crate) const fn failed(code: SafeFailureCode) -> Self {
        Self {
            outcome: AttemptOutcome::Failed,
            code,
        }
    }

    #[must_use]
    pub(crate) const fn timed_out() -> Self {
        Self {
            outcome: AttemptOutcome::TimedOut,
            code: SafeFailureCode::HardTimeout,
        }
    }

    pub(super) const fn outcome(self) -> AttemptOutcome {
        self.outcome
    }

    pub(super) const fn code(self) -> SafeFailureCode {
        self.code
    }

    pub(crate) const fn outcome_wire(self) -> &'static str {
        self.outcome.wire()
    }

    pub(crate) const fn code_wire(self) -> &'static str {
        self.code.wire()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn persisted_vocabulary_is_stable_and_unambiguous() {
        let attempt_outcomes = [
            (AttemptOutcome::Succeeded, "succeeded"),
            (AttemptOutcome::Failed, "failed"),
            (AttemptOutcome::TimedOut, "timed_out"),
            (AttemptOutcome::Superseded, "superseded"),
            (AttemptOutcome::Preempted, "preempted"),
            (AttemptOutcome::GracefulStop, "graceful_stop"),
            (AttemptOutcome::OwnerLost, "owner_lost"),
        ];
        let failure_codes = [
            (SafeFailureCode::ArtifactTooLarge, "artifact_too_large"),
            (
                SafeFailureCode::ArtifactValidationFailed,
                "artifact_validation_failed",
            ),
            (SafeFailureCode::CalculationFailed, "calculation_failed"),
            (
                SafeFailureCode::DependencyRetryExhausted,
                "dependency_retry_exhausted",
            ),
            (SafeFailureCode::HardTimeout, "hard_timeout"),
            (
                SafeFailureCode::InputContractInvalid,
                "input_contract_invalid",
            ),
            (
                SafeFailureCode::InputRevisionViolation,
                "input_revision_violation",
            ),
            (
                SafeFailureCode::LeaseRecoveryExhausted,
                "lease_recovery_exhausted",
            ),
            (
                SafeFailureCode::NonDeterministicOutput,
                "non_deterministic_output",
            ),
            (SafeFailureCode::PublicationFailed, "publication_failed"),
            (SafeFailureCode::ResourceExhausted, "resource_exhausted"),
            (
                SafeFailureCode::TemporaryStorageExhausted,
                "temporary_storage_exhausted",
            ),
            (SafeFailureCode::WorkerCrashed, "worker_crashed"),
        ];
        let delivery_reasons = [
            (DeliveryReason::Superseded, "superseded"),
            (DeliveryReason::TransientRetry, "transient-retry"),
            (DeliveryReason::Preempted, "preempted"),
            (DeliveryReason::GracefulStop, "graceful_stop"),
            (DeliveryReason::LeaseRecovery, "lease-recovery"),
            (DeliveryReason::FollowUp, "followup"),
        ];
        let request_outcomes = [
            (RequestOutcome::Succeeded, "succeeded"),
            (RequestOutcome::Failed, "failed"),
        ];
        let result_dispositions = [
            (ResultDisposition::Published, "published"),
            (ResultDisposition::Reused, "reused"),
        ];

        assert_wires(&attempt_outcomes, AttemptOutcome::wire);
        assert_wires(&failure_codes, SafeFailureCode::wire);
        assert_wires(&delivery_reasons, DeliveryReason::wire);
        assert_wires(&request_outcomes, RequestOutcome::wire);
        assert_wires(&result_dispositions, ResultDisposition::wire);
    }

    fn assert_wires<T: Copy>(cases: &[(T, &'static str)], wire: impl Fn(T) -> &'static str) {
        let actual = cases
            .iter()
            .map(|(value, _)| wire(*value))
            .collect::<Vec<_>>();
        let expected = cases
            .iter()
            .map(|(_, expected)| *expected)
            .collect::<Vec<_>>();
        assert_eq!(actual, expected, "persisted wire vocabulary changed");
        assert_eq!(
            actual.iter().copied().collect::<BTreeSet<_>>().len(),
            actual.len(),
            "persisted wire vocabulary contains duplicate values"
        );
    }
}
