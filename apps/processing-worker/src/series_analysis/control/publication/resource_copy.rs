//! Copies bounded artifact files into staging tables and checks the completed row counts.
//!
//! File revalidation and `PostgreSQL` COPY layout stay together here. Publication owns the
//! surrounding transaction, attestation, fencing, and current/previous pointer transitions.

use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use momo_analysis_core::{
    canonical::sha256_prefixed,
    contract::{ArtifactManifest, CommonResource, ResourceManifest},
};
use tokio_postgres::{Transaction, binary_copy::BinaryCopyInWriter, types::Type};
use tracing::{error, info};

use super::super::transaction::scope_columns;
use super::{ArtifactTotals, ControlError};
use crate::series_analysis::metrics::measure;

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
        ScopeResourceKind::Achievements,
        totals.counts.achievements,
    )
    .await?;
    measure(
        "staging_copy_aggregate",
        copy_scope_resources(
            transaction,
            manifest,
            directory,
            ScopeResourceKind::Aggregate,
            totals.counts.aggregates,
        ),
    )
    .await?;
    measure(
        "staging_copy_review",
        copy_scope_resources(
            transaction,
            manifest,
            directory,
            ScopeResourceKind::Review,
            totals.counts.reviews,
        ),
    )
    .await?;
    measure(
        "staging_copy_drilldown",
        copy_drilldown_resources(transaction, manifest, directory, totals.counts.drilldowns),
    )
    .await?;
    measure(
        "staging_copy_match_context",
        copy_match_context_resources(
            transaction,
            manifest,
            directory,
            totals.counts.match_contexts,
        ),
    )
    .await?;
    copy_scope_resources(
        transaction,
        manifest,
        directory,
        ScopeResourceKind::OutlookSummary,
        totals.counts.outlook_summaries,
    )
    .await?;
    copy_outlook_reference_resources(
        transaction,
        manifest,
        directory,
        totals.counts.outlook_references,
    )
    .await?;
    Ok(())
}

#[derive(Clone, Copy)]
enum ScopeResourceKind {
    Achievements,
    Aggregate,
    Review,
    OutlookSummary,
}

impl ScopeResourceKind {
    const fn wire(self) -> &'static str {
        match self {
            Self::Achievements => "achievements",
            Self::Aggregate => "aggregate",
            Self::Review => "review",
            Self::OutlookSummary => "outlook_summary",
        }
    }

    const fn copy_statement(self) -> &'static str {
        match self {
            Self::Achievements => {
                "COPY series_analysis_achievement_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
            Self::Aggregate => {
                "COPY series_analysis_scope_aggregate_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
            Self::OutlookSummary => {
                "COPY series_analysis_outlook_summary_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
            Self::Review => {
                "COPY series_analysis_scope_review_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY"
            }
        }
    }

    const fn common(self, resource: &ResourceManifest) -> Option<&CommonResource> {
        match (self, resource) {
            (Self::Achievements, ResourceManifest::Achievements { common })
            | (Self::Aggregate, ResourceManifest::Aggregate { common })
            | (Self::Review, ResourceManifest::Review { common })
            | (Self::OutlookSummary, ResourceManifest::OutlookSummary { common }) => Some(common),
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
        let file = ResourceFile::new(directory, common);
        // Admission belongs to the blocking task across caller cancellation, keeping bounded
        // reads from overlapping. The task only reads; database writes stay in this future.
        let payload = crate::blocking::run(move || file.read())
            .await
            .map_err(ControlError::ArtifactValidationTask)??;
        Self::from_payload(common, payload)
    }

    fn from_payload(common: &'a CommonResource, payload: Vec<u8>) -> Result<Self, ControlError> {
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

struct ResourceFile {
    path: PathBuf,
    expected_bytes: u64,
    expected_checksum: String,
}

impl ResourceFile {
    fn new(directory: &Path, common: &CommonResource) -> Self {
        Self {
            path: directory.join(&common.path),
            expected_bytes: common.encoded_bytes,
            expected_checksum: common.checksum.clone(),
        }
    }

    fn read(self) -> Result<Vec<u8>, ControlError> {
        let path_metadata = fs::symlink_metadata(&self.path)?;
        if !path_metadata.is_file()
            || path_metadata.file_type().is_symlink()
            || path_metadata.len() != self.expected_bytes
        {
            return Err(ControlError::InvalidMetadata);
        }
        let file = File::open(self.path)?;
        let opened_metadata = file.metadata()?;
        if !opened_metadata.is_file() || opened_metadata.len() != self.expected_bytes {
            return Err(ControlError::InvalidMetadata);
        }
        let read_limit = self
            .expected_bytes
            .checked_add(1)
            .ok_or(ControlError::NumericBound)?;
        let mut payload = Vec::with_capacity(usize::try_from(read_limit)?);
        file.take(read_limit).read_to_end(&mut payload)?;
        if u64::try_from(payload.len())? != self.expected_bytes
            || sha256_prefixed(&payload) != self.expected_checksum
        {
            return Err(ControlError::InvalidMetadata);
        }
        Ok(payload)
    }
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

async fn copy_outlook_reference_resources(
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
        Type::BYTEA,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::INT4,
        Type::TEXT,
    ];
    let resource_kind = "outlook_reference";
    let sink = transaction
        .copy_in(
            "COPY series_analysis_outlook_reference_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, member_id, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY",
        )
        .await
        .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    let writer = BinaryCopyInWriter::new(sink, &types);
    tokio::pin!(writer);

    for resource in &manifest.resources {
        let ResourceManifest::OutlookReference { common, member_id } = resource else {
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

// Each COPY retains its inserted rows for the statement trigger. Bound payload and row
// overhead independently, while allowing an individually valid large chunk through alone.
const MATCH_CONTEXT_COPY_BYTES: u64 = 2 * 1024 * 1024;
const MATCH_CONTEXT_COPY_ROWS: usize = 512;

fn take_match_context_batch<'a>(
    remaining: &mut &'a [ResourceManifest],
) -> Option<&'a [ResourceManifest]> {
    let mut rows = 0;
    let mut bytes = 0_u64;
    for (index, resource) in remaining.iter().enumerate() {
        let ResourceManifest::MatchContext { common, .. } = resource else {
            continue;
        };
        let combined_bytes = bytes.saturating_add(common.encoded_bytes);
        if rows > 0
            && (rows == MATCH_CONTEXT_COPY_ROWS || combined_bytes > MATCH_CONTEXT_COPY_BYTES)
        {
            let (batch, rest) = remaining.split_at(index);
            *remaining = rest;
            return Some(batch);
        }
        rows += 1;
        bytes = combined_bytes;
    }
    let last = std::mem::take(remaining);
    (rows > 0).then_some(last)
}

async fn load_match_context_batch<'a>(
    directory: &Path,
    batch: &'a [ResourceManifest],
) -> Result<Vec<(ResourceCopyRow<'a>, &'a str, i64)>, ControlError> {
    let mut contexts = Vec::new();
    let mut files = Vec::new();
    for resource in batch {
        if let ResourceManifest::MatchContext {
            common,
            match_id,
            source_match_revision,
        } = resource
        {
            contexts.push((
                common,
                match_id.as_str(),
                source_match_revision.parse::<i64>()?,
            ));
            files.push(ResourceFile::new(directory, common));
        }
    }
    // Revalidate the entire bounded batch under one blocking admission before opening COPY.
    let payloads = crate::blocking::run(move || {
        files
            .into_iter()
            .map(ResourceFile::read)
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(ControlError::ArtifactValidationTask)??;
    contexts
        .into_iter()
        .zip(payloads)
        .map(|((common, match_id, revision), payload)| {
            Ok((
                ResourceCopyRow::from_payload(common, payload)?,
                match_id,
                revision,
            ))
        })
        .collect()
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
    let mut remaining = manifest.resources.as_slice();
    let mut actual = 0;
    while let Some(batch) = take_match_context_batch(&mut remaining) {
        let rows = load_match_context_batch(directory, batch)
            .await
            .map_err(|failure| copy_failure(resource_kind, failure))?;
        let sink = transaction
            .copy_in(
                "COPY series_analysis_match_context_artifacts (artifact_id, scope_key, scope_kind, season_master_id, map_master_id, match_id, source_match_revision, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum) FROM STDIN BINARY",
            )
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
        let writer = BinaryCopyInWriter::new(sink, &types);
        tokio::pin!(writer);
        for (row, match_id, revision) in rows {
            writer
                .as_mut()
                .write(&[
                    &manifest.artifact_id,
                    &row.scope_key,
                    &row.scope_kind,
                    &row.season_id,
                    &row.map_id,
                    &match_id,
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
        actual += writer
            .as_mut()
            .finish()
            .await
            .map_err(|source| copy_failure(resource_kind, ControlError::Postgres(source)))?;
    }
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

    #[test]
    fn match_context_copy_keeps_manifest_order_at_the_row_and_byte_limits() {
        let metadata = |bytes| CommonResource {
            scope: ScopeRef::Overall,
            item_key: String::new(),
            path: String::new(),
            encoded_bytes: bytes,
            decoded_bytes: bytes,
            item_count: 1,
            nesting_depth: 1,
            checksum: String::new(),
        };
        let other = ResourceManifest::Aggregate {
            common: metadata(u64::MAX),
        };
        assert!(
            take_match_context_batch(&mut std::slice::from_ref(&other)).is_none(),
            "other resources must not open a COPY"
        );

        // The first 513 small rows cross only the row limit. The 513th and the
        // next chunk fill exactly 2 MiB; a larger single chunk must still advance.
        let sizes =
            std::iter::repeat_n(2, 513).chain([2 * 1024 * 1024 - 2, 2, 2 * 1024 * 1024 + 1, 2, 2]);
        let mut resources: Vec<_> = sizes
            .enumerate()
            .map(|(index, size)| ResourceManifest::MatchContext {
                common: metadata(size),
                match_id: index.to_string(),
                source_match_revision: String::from("1"),
            })
            .collect();
        resources.insert(1, other.clone());
        resources.push(other);

        let mut remaining = resources.as_slice();
        for expected in [0..512, 512..514, 514..515, 515..516, 516..518] {
            let batch = take_match_context_batch(&mut remaining).expect("next context batch");
            let ids: Vec<_> = batch
                .iter()
                .filter_map(|resource| {
                    let ResourceManifest::MatchContext { match_id, .. } = resource else {
                        return None;
                    };
                    Some(match_id.as_str())
                })
                .collect();
            assert_eq!(ids, expected.map(|id| id.to_string()).collect::<Vec<_>>());
        }
        assert!(
            take_match_context_batch(&mut remaining).is_none(),
            "the final batch must exhaust the manifest"
        );
    }

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
