//! Read-only preparation input and bounded files produced by the sandboxed child.
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};

use momo_analysis_core::{
    contract::ScopeRef,
    model::NormalizedAnalysisInput,
    radar::{
        self, RadarBasis, RadarCandidate, RadarEvaluation, RadarPublishedBasis, RadarSourceSnapshot,
    },
};
use serde::{Deserialize, Serialize};
use tokio_postgres::Transaction;

use super::input_repository::InputRepositoryError;

mod validation;
pub(super) use validation::validate;

const PREPARATION_FILE: &str = "radar-preparation.json";
const STORED_PAYLOAD_BOUND: i32 = 32 * 1024 * 1024;

pub(super) struct RadarReadContext {
    pub(super) work_kind: String,
    pub(super) operation_id: Option<String>,
    pub(super) candidate_id: Option<String>,
    pub(super) preview_id: Option<String>,
    pub(super) basis_id: Option<String>,
    pub(super) basis: Option<RadarBasis>,
    pub(super) source: Option<RadarSourceSnapshot>,
    pub(super) before_basis_id: Option<String>,
    pub(super) before_basis: Option<RadarBasis>,
    pub(super) operation_kind: Option<String>,
}

impl RadarReadContext {
    pub(super) fn public_basis(&self) -> Result<Option<RadarPublishedBasis>, radar::RadarError> {
        // Preparation uses its own before/after inputs and never publishes this projection.
        self.basis_id
            .as_ref()
            .zip(self.basis.as_ref())
            .map(|(id, basis)| {
                Ok(RadarPublishedBasis {
                    basis_id: id.clone(),
                    checksum: basis.checksum()?,
                    basis: basis.clone(),
                })
            })
            .transpose()
    }
}

pub(super) async fn load_context(
    tx: &Transaction<'_>,
    job_id: &str,
    title: &str,
) -> Result<RadarReadContext, InputRepositoryError> {
    if job_id.is_empty() {
        let basis_id: Option<String> = tx
            .query_opt(
                "SELECT current_basis_id FROM series_radar_title_states WHERE game_title_id=$1",
                &[&title],
            )
            .await?
            .map(|r| r.try_get(0))
            .transpose()?
            .flatten();
        let (basis, source) = load_basis(tx, basis_id.as_deref(), title).await?;
        return Ok(RadarReadContext {
            work_kind: String::from("analysis"),
            operation_id: None,
            candidate_id: None,
            preview_id: None,
            basis_id,
            basis,
            source,
            before_basis_id: None,
            before_basis: None,
            operation_kind: None,
        });
    }
    let row = tx.query_opt(
        "SELECT j.work_kind,j.radar_operation_id,j.radar_basis_id,o.kind,o.candidate_id,o.preview_id,c.basis_id,p.before_basis_id \
         FROM series_analysis_jobs j LEFT JOIN series_radar_operations o ON o.id=j.radar_operation_id \
         LEFT JOIN series_radar_candidates c ON c.id=o.candidate_id \
         LEFT JOIN series_radar_previews p ON p.id=o.preview_id \
         WHERE j.id=$1 AND j.game_title_id=$2 AND j.status='running'", &[&job_id,&title]).await?.ok_or(InputRepositoryError::Superseded)?;
    let work_kind: String = row.try_get(0)?;
    let basis_id: Option<String> = if work_kind == "radar_prepare" {
        row.try_get(6)?
    } else {
        row.try_get(2)?
    };
    let before_basis_id = if work_kind == "radar_prepare" {
        tx.query_opt(
            "SELECT current_basis_id FROM series_radar_title_states WHERE game_title_id=$1",
            &[&title],
        )
        .await?
        .map(|r| r.try_get::<_, Option<String>>(0))
        .transpose()?
        .flatten()
    } else {
        row.try_get(7)?
    };
    let (basis, source) = load_basis(tx, basis_id.as_deref(), title).await?;
    let (before_basis, _) = load_basis(tx, before_basis_id.as_deref(), title).await?;
    Ok(RadarReadContext {
        work_kind,
        operation_id: row.try_get(1)?,
        candidate_id: row.try_get(4)?,
        preview_id: row.try_get(5)?,
        basis_id,
        basis,
        source,
        before_basis_id,
        before_basis,
        operation_kind: row.try_get(3)?,
    })
}

pub(super) async fn load_basis(
    tx: &Transaction<'_>,
    id: Option<&str>,
    title: &str,
) -> Result<(Option<RadarBasis>, Option<RadarSourceSnapshot>), InputRepositoryError> {
    let Some(id) = id else {
        return Ok((None, None));
    };
    let row = tx.query_opt("SELECT payload,source_snapshot,checksum FROM series_radar_bases WHERE id=$1 AND game_title_id=$2 AND octet_length(payload::text)<=$3 AND octet_length(source_snapshot::text)<=$3", &[&id,&title,&STORED_PAYLOAD_BOUND]).await?.ok_or(InputRepositoryError::InputContract("radar basis is missing or oversized"))?;
    let invalid = || InputRepositoryError::InputContract("radar basis snapshot is invalid");
    let basis: RadarBasis = serde_json::from_value(row.try_get(0)?).map_err(|_error| invalid())?;
    radar::validate_basis(&basis).map_err(|_error| invalid())?;
    if basis.checksum().map_err(|_error| invalid())? != row.try_get::<_, String>(2)? {
        return Err(invalid());
    }
    let source: Option<RadarSourceSnapshot> = row
        .try_get::<_, Option<serde_json::Value>>(1)?
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_error| invalid())?;
    if basis.source.game_title_id != title
        || source
            .as_ref()
            .is_none_or(|source| source.summary().ok().as_ref() != Some(&basis.source))
    {
        return Err(invalid());
    }
    if let Some(source) = &source {
        source
            .normalized_for_validation(0)
            .map_err(|_error| invalid())?;
    }
    Ok((Some(basis), source))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Preparation {
    pub(super) schema_version: u32,
    pub(super) game_title_id: String,
    pub(super) input_revision: i64,
    pub(super) operation_id: String,
    pub(super) candidate_id: String,
    pub(super) preview_id: Option<String>,
    pub(super) before_basis_id: Option<String>,
    pub(super) candidate: Option<RadarCandidate>,
    pub(super) evaluation_snapshot: RadarSourceSnapshot,
    pub(super) candidate_source_valid: bool,
    pub(super) scopes: Vec<PreparationScope>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct PreparationScope {
    pub(super) scope: ScopeRef,
    pub(super) payload: PreviewPayload,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct PreviewPayload {
    pub(super) before: RadarEvaluation,
    pub(super) after: RadarEvaluation,
}

pub(super) fn compute(
    input: &NormalizedAnalysisInput,
    context: &RadarReadContext,
) -> Result<Preparation, radar::RadarError> {
    let candidate = if context.operation_kind.as_deref() == Some("candidate") {
        Some(radar::generate_candidate(input)?)
    } else {
        None
    };
    let basis = candidate
        .as_ref()
        .and_then(|c| c.basis.as_ref())
        .or(context.basis.as_ref());
    let source_valid = if let Some(source) = context.source.as_ref() {
        radar::source_is_current(source, input)?
    } else {
        candidate.is_some()
    };
    let before = radar::evaluate_scopes(input, context.before_basis.as_ref())?;
    let after = radar::evaluate_scopes(input, basis)?;
    let scopes = before
        .into_iter()
        .zip(after)
        .map(|((scope, before), (_, after))| PreparationScope {
            scope,
            payload: PreviewPayload { before, after },
        })
        .collect();
    Ok(Preparation {
        schema_version: 1,
        game_title_id: input.game_title_id().to_owned(),
        input_revision: input.input_revision(),
        operation_id: context
            .operation_id
            .clone()
            .ok_or(radar::RadarError::InvalidSource)?,
        candidate_id: context
            .candidate_id
            .clone()
            .ok_or(radar::RadarError::InvalidSource)?,
        preview_id: context.preview_id.clone(),
        before_basis_id: context.before_basis_id.clone(),
        candidate,
        evaluation_snapshot: radar::snapshot(input)?,
        candidate_source_valid: source_valid,
        scopes,
    })
}

pub(super) fn write(
    directory: &Path,
    value: &Preparation,
    max_bytes: u64,
) -> Result<u64, std::io::Error> {
    let bytes = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    let length = u64::try_from(bytes.len()).map_err(std::io::Error::other)?;
    if length > max_bytes {
        return Err(std::io::Error::other(
            "radar preparation exceeds its size bound",
        ));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(PREPARATION_FILE))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(length)
}

pub(super) fn read(directory: &Path, max_bytes: u64) -> Result<Preparation, std::io::Error> {
    let path = directory.join(PREPARATION_FILE);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err(std::io::Error::other("invalid radar preparation file"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).map_err(std::io::Error::other)? > max_bytes {
        return Err(std::io::Error::other("oversized radar preparation file"));
    }
    serde_json::from_slice(&bytes).map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests;
