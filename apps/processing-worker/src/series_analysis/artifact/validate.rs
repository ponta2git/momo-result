use std::{collections::BTreeSet, fs, path::Path};

use serde_json::Value;

use momo_analysis_core::{
    canonical::{CanonicalError, parse_canonical_json, sha256_prefixed},
    contract::ArtifactManifest,
    payload,
};

use super::{
    ArtifactError,
    shared::{MANIFEST_FILE_NAME, nesting_depth, resource_common},
};

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
) -> Result<ArtifactManifest, ArtifactError> {
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ArtifactError::UnsafeDirectory);
    }
    let manifest_path = directory.join(MANIFEST_FILE_NAME);
    let manifest_metadata = fs::symlink_metadata(&manifest_path)?;
    if !manifest_metadata.is_file() || manifest_metadata.file_type().is_symlink() {
        return Err(ArtifactError::UnsafeDirectory);
    }
    if manifest_metadata.len() > maximum_chunk_bytes
        || manifest_metadata.len() > maximum_total_bytes
    {
        return Err(ArtifactError::ResourceBound);
    }
    let manifest_bytes = fs::read(&manifest_path)?;
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
    let mut total_bytes = u64::try_from(manifest_bytes.len())?;
    for resource in &manifest.resources {
        let common = resource_common(resource);
        let path = directory.join(&common.path);
        let resource_metadata = fs::symlink_metadata(&path)?;
        if !resource_metadata.is_file() || resource_metadata.file_type().is_symlink() {
            return Err(ArtifactError::UnsafeDirectory);
        }
        if resource_metadata.len() != common.encoded_bytes
            || resource_metadata.len() > maximum_chunk_bytes
        {
            return Err(ArtifactError::ResourceBound);
        }
        let bytes = fs::read(path)?;
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
        let value: Value = serde_json::from_value(parse_canonical_json(&bytes)?)
            .map_err(|error| ArtifactError::Canonical(CanonicalError::InvalidJson(error)))?;
        if nesting_depth(&value) != common.nesting_depth || common.decoded_bytes != length {
            return Err(ArtifactError::ResourceBound);
        }
        payload::validate_manifest(resource, &value)?;
    }
    if total_bytes > maximum_total_bytes {
        return Err(ArtifactError::ResourceBound);
    }
    Ok(manifest)
}
