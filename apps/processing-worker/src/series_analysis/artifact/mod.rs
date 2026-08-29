use std::{io, time::Duration};

use momo_analysis_core::{
    canonical::CanonicalError,
    contract::{ArtifactManifest, ContractError},
    payload,
};
use thiserror::Error;

mod build;
mod shared;
mod validate;

pub(crate) use build::build_artifact;
pub(crate) use validate::{ValidatedArtifact, validate_artifact_directory};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ArtifactBuildRequest {
    pub(crate) artifact_id: String,
    pub(crate) algorithm_version: String,
    pub(crate) maximum_chunk_bytes: u64,
    pub(crate) maximum_chunk_count: u64,
    pub(crate) maximum_total_bytes: u64,
    pub(crate) maximum_file_count: u64,
}

pub(crate) struct BuiltArtifact {
    pub(crate) manifest: ArtifactManifest,
    pub(crate) calculation_duration: Duration,
    pub(crate) encoding_duration: Duration,
    pub(crate) chunk_bytes: u64,
    pub(crate) directory_bytes: u64,
}

#[derive(Debug, Error)]
pub(crate) enum ArtifactError {
    #[error("artifact directory is not an owned empty directory")]
    UnsafeDirectory,
    #[error("artifact file-system operation failed")]
    Io(#[from] io::Error),
    #[error("artifact canonicalization failed")]
    Canonical(#[from] CanonicalError),
    #[error("artifact manifest validation failed")]
    Contract(#[from] ContractError),
    #[error("artifact exceeds its configured resource bounds")]
    ResourceBound,
    #[error("artifact metadata conversion exceeded a supported integer bound")]
    NumericConversion(#[from] std::num::TryFromIntError),
    #[error("artifact payload validation failed")]
    Payload(#[from] payload::PayloadError),
}

#[cfg(test)]
mod tests;
