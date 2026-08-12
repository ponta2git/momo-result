use std::{collections::BTreeSet, fs, path::Path};

const MAXIMUM_MODULE_LINES: usize = 900;
const ALLOWED_DEPENDENCIES: [&str; 5] = [
    "serde",
    "serde_json",
    "serde_json_canonicalizer",
    "sha2",
    "thiserror",
];
const FORBIDDEN_SOURCE_PATTERNS: [&str; 11] = [
    "std::env",
    "std::fs",
    "std::net",
    "std::process",
    "std::thread",
    "std::time",
    "libc::",
    "redis::",
    "tokio::",
    "tokio_postgres",
    "tracing::",
];

#[test]
fn deterministic_kernel_has_no_runtime_dependencies() {
    let manifest = include_str!("../Cargo.toml");
    let dependency_section = manifest
        .split("[dependencies]")
        .nth(1)
        .and_then(|tail| tail.split("\n[").next())
        .unwrap_or_else(|| panic!("core Cargo.toml has no dependency section"));
    let actual_dependencies = dependency_section
        .lines()
        .filter_map(|line| line.split_once('=').map(|(name, _)| name.trim()))
        .collect::<BTreeSet<_>>();
    let allowed_dependencies = ALLOWED_DEPENDENCIES.into_iter().collect::<BTreeSet<_>>();
    assert_eq!(
        actual_dependencies, allowed_dependencies,
        "core dependency set changed; review purity and update the explicit allowlist"
    );

    for source in production_sources() {
        for pattern in FORBIDDEN_SOURCE_PATTERNS {
            assert!(
                !source.body.contains(pattern),
                "{} crosses the kernel/runtime boundary with {pattern}",
                source.relative_path
            );
        }
    }
}

#[test]
fn kernel_modules_stay_within_a_reviewable_responsibility_bound() {
    for source in rust_sources() {
        let line_count = source.body.lines().count();
        assert!(
            line_count <= MAXIMUM_MODULE_LINES,
            "{} has {line_count} lines; split responsibilities before exceeding {MAXIMUM_MODULE_LINES}",
            source.relative_path
        );
    }
}

#[test]
fn kernel_contains_no_unsafe_or_unjustified_lint_suppression() {
    for source in production_sources() {
        assert!(
            !contains_unsafe_code(&source.body),
            "{} contains unsafe code in the deterministic kernel",
            source.relative_path
        );
        assert!(
            !source.body.contains(&["#[", "allow("].concat()),
            "{} suppresses a lint; fix it or use a narrowly justified expectation",
            source.relative_path
        );
    }
}

fn contains_unsafe_code(source: &str) -> bool {
    [
        "unsafe {",
        "unsafe extern ",
        "unsafe fn ",
        "unsafe impl ",
        "unsafe trait ",
    ]
    .into_iter()
    .any(|pattern| source.contains(pattern))
}

struct SourceFile {
    relative_path: String,
    body: String,
}

fn production_sources() -> Vec<SourceFile> {
    rust_sources()
        .into_iter()
        .filter(|source| {
            source.relative_path != "architecture_tests.rs" && source.relative_path != "fixture.rs"
        })
        .collect()
}

fn rust_sources() -> Vec<SourceFile> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut pending = vec![root.clone()];
    let mut sources = Vec::new();
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("failed to inspect {}: {error}", directory.display()));
        for entry in entries {
            let entry =
                entry.unwrap_or_else(|error| panic!("failed to inspect source entry: {error}"));
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let relative_path = path
                    .strip_prefix(&root)
                    .unwrap_or_else(|error| panic!("source escaped crate root: {error}"))
                    .to_string_lossy()
                    .replace('\\', "/");
                let body = fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
                sources.push(SourceFile {
                    relative_path,
                    body,
                });
            }
        }
    }
    sources.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    sources
}
