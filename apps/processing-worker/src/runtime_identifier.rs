//! Closed grammar for worker and lease-owner identifiers shared across control planes.

const MAXIMUM_BYTES: usize = 128;

pub(crate) fn valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_grammar_is_bounded_and_requires_an_alphanumeric_prefix() {
        for valid_identifier in ["worker1", "worker-1", "worker_1.example:slot"] {
            assert!(valid(valid_identifier));
        }
        for invalid_identifier in ["", "-worker", "worker/1", "worker 1"] {
            assert!(!valid(invalid_identifier));
        }
        assert!(valid(&"a".repeat(MAXIMUM_BYTES)));
        assert!(!valid(&"a".repeat(MAXIMUM_BYTES + 1)));
    }
}
