use std::{fs, path::Path};

const MAXIMUM_MODULE_LINES: usize = 900;

#[test]
fn runtime_modules_stay_within_a_reviewable_responsibility_bound() {
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
fn unsafe_code_stays_inside_the_operating_system_boundary() {
    for source in production_sources() {
        if source.relative_path != "process.rs" && !source.relative_path.starts_with("process/") {
            assert!(
                !contains_unsafe_code(&source.body),
                "{} contains unsafe code outside the process module",
                source.relative_path
            );
        }
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

#[test]
fn postgres_rows_are_decoded_without_panicking_getters() {
    for source in production_sources() {
        assert!(
            !source.body.contains(".get::<_,"),
            "{} must use Row::try_get so schema drift is reported instead of panicking",
            source.relative_path
        );
        for index in 0..=32 {
            let infallible_getter = format!(".get({index})");
            assert!(
                !source.body.contains(&infallible_getter),
                "{} contains infallible PostgreSQL getter {infallible_getter}",
                source.relative_path
            );
        }
    }
}

#[test]
fn postgres_adapter_uses_openssl_without_disabling_peer_verification() {
    let manifest = include_str!("../Cargo.toml");
    let adapter = include_str!("postgres.rs");
    assert!(
        manifest.contains("postgres-openssl ="),
        "PostgreSQL transport must use the channel-binding-capable official OpenSSL adapter"
    );
    assert!(
        adapter.contains("postgres_openssl::MakeTlsConnector"),
        "PostgreSQL adapter must construct the reviewed TLS connector"
    );
    for forbidden in [
        "set_verify_hostname(false)",
        "verify_hostname(false)",
        "SslVerifyMode::NONE",
    ] {
        assert!(
            !adapter.contains(forbidden),
            "PostgreSQL adapter disables TLS peer identity verification with {forbidden}"
        );
    }
}

#[test]
fn native_ocr_dependency_is_owned_by_the_ocr_capability_crate() {
    let runtime_manifest = include_str!("../Cargo.toml");
    let ocr_manifest = include_str!("../crates/ocr/Cargo.toml");
    assert!(
        !runtime_manifest.contains("tesseract ="),
        "runtime shell must not own the Tesseract dependency"
    );
    assert!(
        ocr_manifest.contains("tesseract ="),
        "OCR capability crate must own the Tesseract dependency"
    );
}

#[test]
fn supervisor_owns_the_only_production_post_commit_channels() {
    let supervisor = include_str!("supervisor.rs");
    let analysis_consumer = production_section(include_str!("series_analysis/mod.rs"));
    let ocr_consumer = production_section(include_str!("ocr/consumer.rs"));

    assert!(
        supervisor.contains("PostCommitSink::channel(OutboxKind::SeriesAnalysis)"),
        "supervisor must create the process-local Analysis outbox channel"
    );
    assert!(
        supervisor.contains("coordinator::run(driver, wake, shutdown)"),
        "supervisor must run the outbox coordinator as a lifecycle peer"
    );
    for (role, source) in [("analysis", analysis_consumer), ("ocr", ocr_consumer)] {
        assert!(
            source.contains("post_commit_sink: PostCommitSink"),
            "{role} consumer must require the shared post-commit sink"
        );
        assert!(
            !source.contains("PostCommitSink::channel"),
            "{role} consumer must not create or discard its own outbox receiver"
        );
        assert!(
            !source.contains("run_with_post_commit"),
            "{role} consumer must expose one production entry point without a compatibility route"
        );
    }
}

fn production_section(source: &str) -> &str {
    source
        .split_once("#[cfg(test)]")
        .map_or(source, |(production, _tests)| production)
}

struct SourceFile {
    relative_path: String,
    body: String,
}

fn production_sources() -> Vec<SourceFile> {
    rust_sources(Path::new(env!("CARGO_MANIFEST_DIR")).join("src"))
        .into_iter()
        .filter(|source| {
            source.relative_path != "architecture_tests.rs"
                && source.relative_path != "fixture.rs"
                && !source.relative_path.ends_with("/tests.rs")
        })
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
