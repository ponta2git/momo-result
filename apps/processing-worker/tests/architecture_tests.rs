#![expect(
    clippy::panic,
    reason = "architecture-test discovery failures must identify the unreadable source path"
)]

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    #[test]
    fn outbox_coordination_stays_in_the_runtime_shell() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let runtime_outbox = read_tree(&root.join("src/outbox"));
        for forbidden in [
            "crate::ocr",
            "crate::series_analysis",
            "crate::supervisor",
            "tokio_postgres",
            "redis::",
        ] {
            assert!(
                !runtime_outbox.contains(forbidden),
                "root outbox coordination leaked a role or infrastructure dependency: {forbidden}"
            );
        }

        for capability in ["analysis-core", "ocr"] {
            let capability_root = root.join("crates").join(capability);
            let manifest = fs::read_to_string(capability_root.join("Cargo.toml"))
                .unwrap_or_else(|error| panic!("failed to read {capability} manifest: {error}"));
            let sources = read_tree(&capability_root.join("src"));
            assert!(
                !manifest.contains("momo-processing-worker"),
                "{capability} capability must not depend on the processing runtime"
            );
            assert!(
                !sources.contains("momo_processing_worker::outbox"),
                "{capability} capability must not import runtime outbox contracts"
            );
        }
    }

    fn read_tree(root: &Path) -> String {
        let mut pending = vec![root.to_path_buf()];
        let mut body = String::new();
        while let Some(directory) = pending.pop() {
            let entries = fs::read_dir(&directory).unwrap_or_else(|error| {
                panic!("failed to inspect {}: {error}", directory.display())
            });
            for entry in entries {
                let entry =
                    entry.unwrap_or_else(|error| panic!("failed to inspect source: {error}"));
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                } else if path.extension().is_some_and(|extension| extension == "rs") {
                    body.push_str(&fs::read_to_string(&path).unwrap_or_else(|error| {
                        panic!("failed to read {}: {error}", path.display())
                    }));
                }
            }
        }
        body
    }
}
