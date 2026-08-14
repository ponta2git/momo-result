use std::ffi::OsString;

use super::ProcessError;
use crate::series_analysis::config::CHILD_MEMORY_LIMIT_ENV;

pub(super) fn command_allowed(arguments: &[OsString]) -> bool {
    let Some(command) = arguments.first().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        command,
        "worker"
            | "release-audit"
            | "release-promote"
            | "shadow-endurance"
            | "probe-cgroup-limit"
            | "probe-ocr-child-lifecycle"
            | "ocr-r2-endurance"
            | "ocr-local-endurance"
    )
}

pub(super) fn requires_child_cgroup(arguments: &[OsString]) -> bool {
    arguments
        .first()
        .and_then(|value| value.to_str())
        .is_some_and(|command| {
            matches!(
                command,
                "worker"
                    | "shadow-endurance"
                    | "probe-cgroup-limit"
                    | "probe-ocr-child-lifecycle"
                    | "ocr-r2-endurance"
                    | "ocr-local-endurance"
            )
        })
}

pub(super) fn child_memory_limit() -> Result<u64, ProcessError> {
    std::env::var(CHILD_MEMORY_LIMIT_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or(ProcessError::BootstrapConfiguration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_command_allowlist_excludes_hidden_children_and_recursion() {
        for command in [
            "worker",
            "release-audit",
            "release-promote",
            "shadow-endurance",
            "probe-cgroup-limit",
            "probe-ocr-child-lifecycle",
            "ocr-r2-endurance",
            "ocr-local-endurance",
        ] {
            assert!(command_allowed(&[OsString::from(command)]), "{command}");
        }
        for command in [
            "bootstrap",
            "child-compute",
            "child-cgroup-allocate",
            "child-ocr",
        ] {
            assert!(!command_allowed(&[OsString::from(command)]), "{command}");
        }
        assert!(!command_allowed(&[]));
    }

    #[test]
    fn only_compute_capable_commands_prepare_the_child_cgroup() {
        for command in [
            "worker",
            "shadow-endurance",
            "probe-cgroup-limit",
            "probe-ocr-child-lifecycle",
            "ocr-r2-endurance",
            "ocr-local-endurance",
        ] {
            assert!(
                requires_child_cgroup(&[OsString::from(command)]),
                "{command}"
            );
        }
        for command in ["release-audit", "release-promote"] {
            assert!(
                !requires_child_cgroup(&[OsString::from(command)]),
                "{command}"
            );
        }
    }
}
