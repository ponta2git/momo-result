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
fn database_tls_preserves_peer_verification_and_channel_binding() {
    let manifest = include_str!("../Cargo.toml");
    let adapter = include_str!("database.rs");
    assert!(
        manifest.contains("postgres-openssl ="),
        "database transport must use the channel-binding-capable official OpenSSL adapter"
    );
    assert!(
        adapter.contains("postgres_openssl::MakeTlsConnector"),
        "database adapter must construct the reviewed TLS connector"
    );
    for forbidden in [
        "set_verify_hostname(false)",
        "verify_hostname(false)",
        "SslVerifyMode::NONE",
    ] {
        assert!(
            !adapter.contains(forbidden),
            "database adapter disables TLS peer identity verification with {forbidden}"
        );
    }
}

#[test]
fn production_workflow_probes_the_exact_disabled_image_before_publication() {
    let workflow = include_str!("../../../.github/workflows/analysis-production.yml");
    let missing = workflow.len();
    let probe = workflow
        .find("- name: Probe production dependencies before publication")
        .unwrap_or(missing);
    let enable = workflow
        .find("- name: Deploy analysis worker with publication enabled")
        .unwrap_or(missing);
    assert_ne!(
        probe, missing,
        "production workflow must contain the dependency probe"
    );
    assert_ne!(
        enable, missing,
        "production workflow must contain the publication step"
    );
    assert!(
        probe < enable,
        "production dependencies must be probed before publication is enabled"
    );
    for required in [
        "length == 1",
        ".config.image == $image",
        ".config.env.MOMO_ANALYSIS_PUBLICATION_MODE == \"disabled\"",
        "release-dependency-probe",
        ".controlReadOnly == false",
        ".readerReadOnly == true",
        ".redisPong == true",
    ] {
        assert!(
            workflow.contains(required),
            "production dependency gate is missing {required}"
        );
    }
}

#[test]
fn runtime_does_not_flatten_or_reexport_the_kernel_api() {
    let facade = include_str!("lib.rs");
    assert!(
        !facade.contains("pub use momo_analysis_core"),
        "runtime crate must not turn kernel internals into its own public API"
    );
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
