use std::{collections::BTreeSet, fs, path::Path};

const MAXIMUM_MODULE_LINES: usize = 900;
const ALLOWED_DEPENDENCIES: [&str; 7] = [
    "image",
    "regex",
    "serde",
    "serde_json",
    "tesseract",
    "thiserror",
    "unicode-normalization",
];
const FORBIDDEN_SOURCE_PATTERNS: [&str; 10] = [
    "std::env",
    "std::net",
    "std::process",
    "libc::",
    "redis::",
    "aws_sdk_s3",
    "tokio::",
    "tokio_postgres",
    "tracing::",
    "momo_processing_worker",
];

#[test]
fn capability_has_no_processing_runtime_dependencies() {
    let manifest = include_str!("../Cargo.toml");
    let dependency_section = manifest
        .split("[dependencies]")
        .nth(1)
        .and_then(|tail| tail.split("\n[").next())
        .unwrap_or_else(|| panic!("OCR Cargo.toml has no dependency section"));
    let actual_dependencies = dependency_section
        .lines()
        .filter_map(|line| line.split_once('=').map(|(name, _)| name.trim()))
        .collect::<BTreeSet<_>>();
    let allowed_dependencies = ALLOWED_DEPENDENCIES.into_iter().collect::<BTreeSet<_>>();
    assert_eq!(
        actual_dependencies, allowed_dependencies,
        "OCR capability dependencies changed; review the processing-runtime boundary"
    );

    for source in production_sources() {
        for pattern in FORBIDDEN_SOURCE_PATTERNS {
            assert!(
                !source.body.contains(pattern),
                "{} crosses the capability/processing-runtime boundary with {pattern}",
                source.relative_path
            );
        }
    }
}

#[test]
fn capability_modules_stay_within_a_reviewable_responsibility_bound() {
    for source in rust_sources(Path::new(env!("CARGO_MANIFEST_DIR")).join("src")) {
        let line_count = source.body.lines().count();
        assert!(
            line_count <= MAXIMUM_MODULE_LINES,
            "{} has {line_count} lines; split responsibilities before exceeding {MAXIMUM_MODULE_LINES}",
            source.relative_path
        );
    }
}

#[test]
fn capability_has_no_unsafe_code_or_unjustified_lint_suppression() {
    for source in production_sources() {
        assert!(
            !contains_unsafe_code(&source.body),
            "{} contains unsafe code in the OCR capability",
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
    rust_sources(Path::new(env!("CARGO_MANIFEST_DIR")).join("src"))
        .into_iter()
        .filter(|source| source.relative_path != "architecture_tests.rs")
        .collect()
}

fn rust_sources(root: impl AsRef<Path>) -> Vec<SourceFile> {
    let root = root.as_ref();
    let mut pending = vec![root.to_path_buf()];
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
                    .strip_prefix(root)
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
