use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Read,
    path::Path,
};

use momo_analysis_core::{
    canonical::{CanonicalError, parse_canonical_json, sha256_prefixed},
    contract::{ARTIFACT_VALIDATION_CONTRACT_ID, ArtifactManifest},
    payload,
};

use super::{
    ArtifactError,
    shared::{MANIFEST_FILE_NAME, nesting_depth, resource_common},
};

/// An artifact accepted by the complete Rust-owned publication validator.
///
/// The constructor is private to this module: publication code can only obtain this type by
/// reopening the artifact directory and passing every bounded file, canonical, schema, semantic,
/// and cross-resource check in [`validate_artifact_directory`].
pub(crate) struct ValidatedArtifact {
    manifest: ArtifactManifest,
    radar_basis: Option<(String, String)>,
    validation_contract_id: &'static str,
}

impl ValidatedArtifact {
    #[must_use]
    pub(crate) const fn manifest(&self) -> &ArtifactManifest {
        &self.manifest
    }

    #[must_use]
    pub(crate) const fn validation_contract_id(&self) -> &'static str {
        self.validation_contract_id
    }

    #[must_use]
    pub(crate) fn radar_basis(&self) -> Option<(&str, &str)> {
        self.radar_basis
            .as_ref()
            .map(|(id, checksum)| (id.as_str(), checksum.as_str()))
    }

    const fn new(manifest: ArtifactManifest, radar_basis: Option<(String, String)>) -> Self {
        Self {
            manifest,
            radar_basis,
            validation_contract_id: ARTIFACT_VALIDATION_CONTRACT_ID,
        }
    }
}

/// Re-opens and validates every declared file without loading all chunks at once.
///
/// # Errors
///
/// Returns an error for undeclared files, links, byte/checksum drift, or a manifest violation.
pub(crate) fn validate_artifact_directory(
    directory: &Path,
    maximum_chunk_count: u64,
    maximum_chunk_bytes: u64,
    maximum_total_bytes: u64,
    maximum_file_count: u64,
) -> Result<ValidatedArtifact, ArtifactError> {
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ArtifactError::UnsafeDirectory);
    }
    let manifest_path = directory.join(MANIFEST_FILE_NAME);
    let manifest_bytes =
        read_bounded_regular_file(&manifest_path, maximum_chunk_bytes.min(maximum_total_bytes))?;
    let manifest: ArtifactManifest = serde_json::from_value(parse_canonical_json(&manifest_bytes)?)
        .map_err(|error| ArtifactError::Canonical(CanonicalError::InvalidJson(error)))?;
    manifest.validate(maximum_chunk_count, maximum_chunk_bytes)?;
    let declared = manifest
        .resources
        .iter()
        .map(|resource| resource_common(resource).path.as_str())
        .collect::<BTreeSet<_>>();
    let mut file_count = 0_u64;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        file_count = file_count
            .checked_add(1)
            .ok_or(ArtifactError::ResourceBound)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(ArtifactError::UnsafeDirectory);
        };
        if file_count > maximum_file_count
            || (name != MANIFEST_FILE_NAME && !declared.contains(name))
        {
            return Err(ArtifactError::UnsafeDirectory);
        }
    }
    drop(declared);
    let mut total_bytes = u64::try_from(manifest_bytes.len())?;
    drop(manifest_bytes);
    let mut payloads = payload::PayloadSetValidator::new();
    let mut radar_basis = None;
    for resource in &manifest.resources {
        let common = resource_common(resource);
        let path = directory.join(&common.path);
        let remaining_total_bytes = maximum_total_bytes
            .checked_sub(total_bytes)
            .ok_or(ArtifactError::ResourceBound)?;
        if common.encoded_bytes > remaining_total_bytes {
            return Err(ArtifactError::ResourceBound);
        }
        let bytes =
            read_bounded_regular_file(&path, maximum_chunk_bytes.min(remaining_total_bytes))?;
        let length = u64::try_from(bytes.len())?;
        total_bytes = total_bytes
            .checked_add(length)
            .ok_or(ArtifactError::ResourceBound)?;
        if length != common.encoded_bytes
            || length > maximum_chunk_bytes
            || sha256_prefixed(&bytes) != common.checksum
        {
            return Err(ArtifactError::ResourceBound);
        }
        let value = parse_canonical_json(&bytes)?;
        drop(bytes);
        if nesting_depth(&value) != common.nesting_depth || common.decoded_bytes != length {
            return Err(ArtifactError::ResourceBound);
        }
        payloads.add_manifest(resource, &value)?;
        if matches!(
            resource,
            momo_analysis_core::contract::ResourceManifest::Aggregate { .. }
        ) && common.scope == momo_analysis_core::contract::ScopeRef::Overall
            && let Some(basis) = value
                .pointer("/playerRadar/basis")
                .filter(|value| !value.is_null())
        {
            let id = basis
                .get("basisId")
                .and_then(serde_json::Value::as_str)
                .ok_or(payload::PayloadError::ReferenceMismatch)?;
            let checksum = basis
                .get("checksum")
                .and_then(serde_json::Value::as_str)
                .ok_or(payload::PayloadError::ReferenceMismatch)?;
            radar_basis = Some((id.to_owned(), checksum.to_owned()));
        }
    }
    payloads.finish()?;
    Ok(ValidatedArtifact::new(manifest, radar_basis))
}

fn read_bounded_regular_file(path: &Path, maximum_bytes: u64) -> Result<Vec<u8>, ArtifactError> {
    let path_metadata = fs::symlink_metadata(path)?;
    if !path_metadata.is_file() || path_metadata.file_type().is_symlink() {
        return Err(ArtifactError::UnsafeDirectory);
    }
    if path_metadata.len() > maximum_bytes {
        return Err(ArtifactError::ResourceBound);
    }
    let file = File::open(path)?;
    let opened_metadata = file.metadata()?;
    if !opened_metadata.is_file() || opened_metadata.len() > maximum_bytes {
        return Err(ArtifactError::ResourceBound);
    }
    let read_limit = maximum_bytes
        .checked_add(1)
        .ok_or(ArtifactError::ResourceBound)?;
    let mut bytes = Vec::new();
    file.take(read_limit).read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len())? > maximum_bytes {
        Err(ArtifactError::ResourceBound)
    } else {
        Ok(bytes)
    }
}
