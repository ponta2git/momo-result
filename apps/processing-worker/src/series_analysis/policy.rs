use crate::process::AnalysisChildOutcome;

use super::{
    AttemptInterruption,
    control::{AttemptFailure, RequeueCause, SafeFailureCode},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ChildAction {
    Publish,
    Supersede,
    RetryTransient,
    Fail(AttemptFailure),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum InterruptionAction {
    Fail(AttemptFailure),
    Requeue {
        cause: RequeueCause,
        stop_consumer: bool,
    },
    LeavePending,
}

pub(super) const fn child_action(outcome: AnalysisChildOutcome) -> ChildAction {
    match outcome {
        AnalysisChildOutcome::Succeeded => ChildAction::Publish,
        AnalysisChildOutcome::Superseded => ChildAction::Supersede,
        AnalysisChildOutcome::DependencyFailed => ChildAction::RetryTransient,
        AnalysisChildOutcome::InputInvalid => ChildAction::Fail(AttemptFailure::failed(
            SafeFailureCode::InputContractInvalid,
        )),
        AnalysisChildOutcome::ArtifactTooLarge => {
            ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::ArtifactTooLarge))
        }
        AnalysisChildOutcome::ResourceExhausted => {
            ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::ResourceExhausted))
        }
        AnalysisChildOutcome::ParentLivenessLost => {
            ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::WorkerCrashed))
        }
        AnalysisChildOutcome::CalculationFailed => {
            ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::CalculationFailed))
        }
    }
}

pub(super) const fn interruption_action(interruption: AttemptInterruption) -> InterruptionAction {
    match interruption {
        AttemptInterruption::TimedOut => InterruptionAction::Fail(AttemptFailure::timed_out()),
        AttemptInterruption::Preempted => InterruptionAction::Requeue {
            cause: RequeueCause::Preempted,
            stop_consumer: false,
        },
        AttemptInterruption::Shutdown => InterruptionAction::Requeue {
            cause: RequeueCause::GracefulStop,
            stop_consumer: true,
        },
        AttemptInterruption::OwnerLost => InterruptionAction::LeavePending,
        AttemptInterruption::WorkerCrashed => {
            InterruptionAction::Fail(AttemptFailure::failed(SafeFailureCode::WorkerCrashed))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_child_outcome_has_one_explicit_control_plane_action() {
        let cases = [
            (AnalysisChildOutcome::Succeeded, ChildAction::Publish),
            (AnalysisChildOutcome::Superseded, ChildAction::Supersede),
            (
                AnalysisChildOutcome::DependencyFailed,
                ChildAction::RetryTransient,
            ),
            (
                AnalysisChildOutcome::InputInvalid,
                ChildAction::Fail(AttemptFailure::failed(
                    SafeFailureCode::InputContractInvalid,
                )),
            ),
            (
                AnalysisChildOutcome::ArtifactTooLarge,
                ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::ArtifactTooLarge)),
            ),
            (
                AnalysisChildOutcome::ResourceExhausted,
                ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::ResourceExhausted)),
            ),
            (
                AnalysisChildOutcome::ParentLivenessLost,
                ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::WorkerCrashed)),
            ),
            (
                AnalysisChildOutcome::CalculationFailed,
                ChildAction::Fail(AttemptFailure::failed(SafeFailureCode::CalculationFailed)),
            ),
        ];

        for (outcome, expected) in cases {
            assert_eq!(
                child_action(outcome),
                expected,
                "wrong action for {outcome:?}"
            );
        }
    }

    #[test]
    fn interruption_policy_preserves_retry_and_ack_semantics() {
        let cases = [
            (
                AttemptInterruption::TimedOut,
                InterruptionAction::Fail(AttemptFailure::timed_out()),
            ),
            (
                AttemptInterruption::Preempted,
                InterruptionAction::Requeue {
                    cause: RequeueCause::Preempted,
                    stop_consumer: false,
                },
            ),
            (
                AttemptInterruption::Shutdown,
                InterruptionAction::Requeue {
                    cause: RequeueCause::GracefulStop,
                    stop_consumer: true,
                },
            ),
            (
                AttemptInterruption::OwnerLost,
                InterruptionAction::LeavePending,
            ),
            (
                AttemptInterruption::WorkerCrashed,
                InterruptionAction::Fail(AttemptFailure::failed(SafeFailureCode::WorkerCrashed)),
            ),
        ];

        for (interruption, expected) in cases {
            assert_eq!(
                interruption_action(interruption),
                expected,
                "wrong action for {interruption:?}"
            );
        }
    }
}
