//! Copies bounded artifact files into staging tables and checks the completed row counts.
//!
//! File revalidation and `PostgreSQL` COPY layout stay together here. Publication owns the
//! surrounding transaction, attestation, fencing, and current/previous pointer transitions.

use std::{
    fs::{self, File},
    io::Read,
    path::Path,
};

use momo_analysis_core::{
    canonical::sha256_prefixed,
    contract::{ArtifactManifest, CommonResource, ResourceManifest},
};
use tokio_postgres::{Transaction, binary_copy::BinaryCopyInWriter, types::Type};
use tracing::{error, info};

use super::super::transaction::scope_columns;
use super::{ArtifactTotals, ControlError};

pub(super) async fn copy_artifact_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    totals: &ArtifactTotals,
) -> Result<(), ControlError> {
    copy_scope_resources(
        transaction,
        manifest,
        directory,
        ScopeResourceKind::Aggregate,
        totals.counts.aggregates,
    )
    .await?;
    copy_scope_resources(
        transaction,
        manifest,
        directory,
        ScopeResourceKind::Review,
        totals.counts.reviews,
    )
    .await?;
    copy_drilldown_resources(transaction, manifest, directory, totals.counts.drilldowns).await?;
    copy_match_context_resources(
        transaction,
        manifest,
        directory,
        totals.counts.match_contexts,
    )
    .await?;
    Ok(())
}

#[derive(Clone, Copy)]
enum ScopeResourceKind {
    Aggregate,
    Review,
}

impl ScopeResourceKind {
    const fn wire(self) -> &'static str {
        match self {
            Self::Aggregate => "aggregate",
            Self::Review => "review",
        }
    }

    const fn copy_statement(self) -> &'static str {
        match self {
            Self::Aggregate => {
                "COPY series_analysis_scope_aggregate_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
            Self::Review => {
                "COPY series_analysis_scope_review_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
        }
    }

    const fn common(self, resource: &ResourceManifest) -> Option<&CommonResource> {
        match (self, resource) {
            (Self::Aggregate, ResourceManifest::Aggregate { common })
            | (Self::Review, ResourceManifest::Review { common }) => Some(common),
            _ => None,
        }
    }
}

struct ResourceCopyRow<'a> {
    scope_key: String,
    scope_kind: &'static str,
    season_id: Option<&'a str>,
    map_id: Option<&'a str>,
    payload: Vec<u8>,
    encoded_bytes: i32,
    decoded_bytes: i32,
    item_count: i32,
    nesting_depth: i32,
    checksum: &'a str,
}

impl<'a> ResourceCopyRow<'a> {
    async fn load(directory: &Path, common: &'a CommonResource) -> Result<Self, ControlError> {
        let path = directory.join(&common.path);
        let expected_bytes = common.encoded_bytes;
        let expected_checksum = common.checksum.clone();
        // One blocking task owns metadata, read, and hashing for this file. Only one bounded
        // payload is in flight; cancellation can leave a read running, never a database write.
        let payload = tokio::task::spawn_blocking(move || {
            read_resource_payload(&path, expected_bytes, &expected_checksum)
        })
        .await
        .map_err(ControlError::ArtifactValidationTask)??;
        let (scope_kind, season_id, map_id) = scope_columns(&common.scope);
        Ok(Self {
            scope_key: common.scope.key(),
            scope_kind,
            season_id,
            map_id,
            payload,
            encoded_bytes: i32::try_from(common.encoded_bytes)?,
            decoded_bytes: i32::try_from(common.decoded_bytes)?,
            item_count: i32::try_from(common.item_count)?,
            nesting_depth: i32::try_from(common.nesting_depth)?,
            checksum: &common.checksum,
        })
    }
}

fn read_resource_payload(
    path: &Path,
    expected_bytes: u64,
    expected_checksum: &str,
) -> Result<Vec<u8>, ControlError> {
    let path_metadata = fs::symlink_metadata(path)?;
    if !path_metadata.is_file()
        || path_metadata.file_type().is_symlink()
        || path_metadata.len() != expected_bytes
    {
        return Err(ControlError::InvalidMetadata);
    }
    let file = File::open(path)?;
    let opened_metadata = file.metadata()?;
    if !opened_metadata.is_file() || opened_metadata.len() != expected_bytes {
        return Err(ControlError::InvalidMetadata);
    }
    let read_limit = expected_bytes
        .checked_add(1)
        .ok_or(ControlError::NumericBound)?;
    let mut payload = Vec::with_capacity(usize::try_from(read_limit)?);
    file.take(read_limit).read_to_end(&mut payload)?;
    if u64::try_from(payload.len())? != expected_bytes
        || sha256_prefixed(&payload) != expected_checksum
    {
        return Err(ControlError::InvalidMetadata);
    }
    Ok(payload)
}

async fn copy_scope_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    kind: ScopeResourceKind,
    expected_count: i32,
) -> Result<(), ControlError> {
    if expected_count == 0 {
        return Ok(());
    }
    let resource_kind = kind.wire();
    let types = [
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let sink = transaction
        .copy_in(kind.copy_statement())
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let Some(common) = kind.common(resource) else {
            continue;
        };
        let row = ResourceCopyRow::load(directory, common)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        writer
            .as_mut()
            .write(&[
                &manifest.artifact_id,
                &row.scope_key,
                &row.scope_kind,
                &row.season_id,
                &row.map_id,
                &row.payload,
                &row.encoded_bytes,
                &row.decoded_bytes,
                &row.item_count,
                &row.nesting_depth,
                &row.checksum,
            ])
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
    let actual = writer
        .as_mut()
        .finish()
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    verify_copy_count(resource_kind, actual, expected_count)
}

async fn copy_drilldown_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    expected_count: i32,
) -> Result<(), ControlError> {
    if expected_count == 0 {
        return Ok(());
    }
    let types = [
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let resource_kind = "drilldown";
    let sink = transaction
        .copy_in(
            "COPY series_analysis_drilldown_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, member_id, metric_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY",
        )
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let ResourceManifest::Drilldown {
            common,
            member_id,
            metric_id,
        } = resource
        else {
            continue;
        };
        let row = ResourceCopyRow::load(directory, common)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        writer
            .as_mut()
            .write(&[
                &manifest.artifact_id,
                &row.scope_key,
                &row.scope_kind,
                &row.season_id,
                &row.map_id,
                member_id,
                metric_id,
                &row.payload,
                &row.encoded_bytes,
                &row.decoded_bytes,
                &row.item_count,
                &row.nesting_depth,
                &row.checksum,
            ])
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
    let actual = writer
        .as_mut()
        .finish()
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    verify_copy_count(resource_kind, actual, expected_count)
}

async fn copy_match_context_resources(
    transaction: &Transaction<'_>,
    manifest: &ArtifactManifest,
    directory: &Path,
    expected_count: i32,
) -> Result<(), ControlError> {
    if expected_count == 0 {
        return Ok(());
    }
    let types = [
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::TEXT,
        Type::INT8,
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let resource_kind = "match_context";
    let sink = transaction
        .copy_in(
            "COPY series_analysis_match_context_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, match_id, source_match_revision, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY",
        )
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let ResourceManifest::MatchContext {
            common,
            match_id,
            source_match_revision,
        } = resource
        else {
            continue;
        };
        let revision = source_match_revision.parse::<i64>()?;
        let row = ResourceCopyRow::load(directory, common)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        writer
            .as_mut()
            .write(&[
                &manifest.artifact_id,
                &row.scope_key,
                &row.scope_kind,
                &row.season_id,
                &row.map_id,
                match_id,
                &revision,
                &row.payload,
                &row.encoded_bytes,
                &row.decoded_bytes,
                &row.item_count,
                &row.nesting_depth,
                &row.checksum,
            ])
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
    let actual = writer
        .as_mut()
        .finish()
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    verify_copy_count(resource_kind, actual, expected_count)
}

fn verify_copy_count(
    resource_kind: &'static str,
    actual: u64,
    expected: i32,
) -> Result<(), ControlError> {
    if actual == u64::try_from(expected)? {
        info!(
            event = "analysis_artifact_copy_completed",
            phase = "publication_copy",
            resource_kind,
            row_count = actual,
            "analysis artifact resources were copied"
        );
        Ok(())
    } else {
        error!(
            event = "analysis_artifact_copy_failed",
            phase = "publication_copy",
            resource_kind,
            error_kind = "publication_row_count",
            expected_row_count = expected,
            actual_row_count = actual,
            "analysis artifact COPY row count was inconsistent"
        );
        Err(ControlError::PublicationRowCount)
    }
}

fn copy_failure(resource_kind: &'static str, failure: ControlError) -> ControlError {
    error!(
        event = "analysis_artifact_copy_failed",
        phase = "publication_copy",
        resource_kind,
        error_kind = failure.kind(),
        "analysis artifact COPY failed"
    );
    failure
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "owned temporary files exercise the revalidation boundary immediately before COPY"
)]
mod tests {
    use momo_analysis_core::contract::ScopeRef;

    use super::*;

    #[tokio::test]
    async fn reread_rejects_changed_files_and_preserves_infrastructure_errors() {
        let directory = tempfile::tempdir().expect("owned temporary directory");
        let bytes = br#"{"value":1}"#;
        let path = directory.path().join("resource.json");
        fs::write(&path, bytes).expect("original resource");
        let common = CommonResource {
            scope: ScopeRef::Overall,
            item_key: String::from("overall"),
            path: String::from("resource.json"),
            encoded_bytes: u64::try_from(bytes.len()).expect("small resource"),
            decoded_bytes: u64::try_from(bytes.len()).expect("small resource"),
            item_count: 1,
            nesting_depth: 2,
            checksum: sha256_prefixed(bytes),
        };
        let row = ResourceCopyRow::load(directory.path(), &common)
            .await
            .expect("unchanged resource");
        assert_eq!(row.payload, bytes);

        fs::write(&path, br#"{"value":2}"#).expect("same-sized changed resource");
        assert!(matches!(
            ResourceCopyRow::load(directory.path(), &common).await,
            Err(ControlError::InvalidMetadata)
        ));
        fs::write(&path, b"{}").expect("truncated resource");
        assert!(matches!(
            ResourceCopyRow::load(directory.path(), &common).await,
            Err(ControlError::InvalidMetadata)
        ));
        fs::remove_file(&path).expect("remove owned fixture");
        assert!(
            matches!(
                ResourceCopyRow::load(directory.path(), &common).await,
                Err(ControlError::Io(_))
            ),
            "a missing file must retain the infrastructure-failure recovery policy"
        );

        #[cfg(unix)]
        {
            let target = directory.path().join("target.json");
            fs::write(&target, bytes).expect("valid symlink target");
            std::os::unix::fs::symlink(&target, &path).expect("symlink resource");
            assert!(matches!(
                ResourceCopyRow::load(directory.path(), &common).await,
                Err(ControlError::InvalidMetadata)
            ));
        }
    }
}
