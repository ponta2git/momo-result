//! Read-only preparation input and bounded files produced by the sandboxed child.
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};

use momo_analysis_core::{
    achievements::{self, AchievementCurve, AchievementPayload, AchievementPreview},
    contract::ScopeRef,
    model::NormalizedAnalysisInput,
    radar::{
        self, RadarBasis, RadarCandidate, RadarEvaluation, RadarManualInput, RadarPublishedBasis,
        RadarSourceSnapshot,
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
    pub(super) manual: Option<Box<ManualCandidateContext>>,
}

pub(super) struct ManualCandidateContext {
    pub(super) input: RadarManualInput,
    pub(super) source_basis_id: String,
    pub(super) source_candidate_id: Option<String>,
    pub(super) source_basis: RadarBasis,
}

impl RadarReadContext {
    pub(super) fn is_manual(&self) -> bool {
        self.manual.is_some()
            || self
                .basis
                .as_ref()
                .is_some_and(|basis| basis.manual.is_some())
    }

    pub(super) fn new_manual_basis(
        &self,
        input: &NormalizedAnalysisInput,
    ) -> Result<Option<RadarBasis>, radar::RadarError> {
        if self.basis.is_some() {
            return Ok(None);
        }
        self.manual
            .as_ref()
            .map(|manual| {
                radar::create_manual_basis(
                    input,
                    &manual.source_basis,
                    &manual.source_basis_id,
                    manual.source_candidate_id.as_deref(),
                    &manual.input,
                )
            })
            .transpose()
            .map(Option::flatten)
    }

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
                "SELECT (SELECT legacy_id FROM series_radar_basis_identities WHERE id=current_basis_id) FROM series_radar_title_states WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)",
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
            manual: None,
        });
    }
    let row = tx.query_opt(
        "SELECT j.work_kind,j.legacy_radar_operation_id,(SELECT legacy_id FROM series_radar_basis_identities WHERE id=j.radar_basis_id),o.kind,c.legacy_id,p.legacy_id,(SELECT legacy_id FROM series_radar_basis_identities WHERE id=c.basis_id),(SELECT legacy_id FROM series_radar_basis_identities WHERE id=p.before_basis_id), \
         c.origin_kind,CASE WHEN octet_length(c.manual_input::text)<=65536 THEN c.manual_input END,c.source_basis_id,c.source_candidate_id \
         FROM series_analysis_jobs j LEFT JOIN series_radar_operations o ON o.id=j.radar_operation_id \
         LEFT JOIN series_radar_candidates c ON c.id=o.candidate_id \
         LEFT JOIN series_radar_previews p ON p.id=o.preview_id \
         WHERE j.legacy_id=$1 AND j.game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$2) AND j.status='running'", &[&job_id,&title]).await?.ok_or(InputRepositoryError::Superseded)?;
    let work_kind: String = row.try_get(0)?;
    let basis_id: Option<String> = if work_kind == "radar_prepare" {
        row.try_get(6)?
    } else {
        row.try_get(2)?
    };
    let before_basis_id = if work_kind == "radar_prepare" {
        tx.query_opt(
            "SELECT (SELECT legacy_id FROM series_radar_basis_identities WHERE id=current_basis_id) FROM series_radar_title_states WHERE game_title_id=(SELECT id FROM game_titles WHERE legacy_id=$1)",
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
    let manual = if work_kind == "radar_prepare"
        && row.try_get::<_, Option<String>>(8)?.as_deref() == Some("manual")
    {
        Some(Box::new(load_manual_context(tx, title, &row).await?))
    } else {
        None
    };
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
        manual,
    })
}

async fn load_manual_context(
    tx: &Transaction<'_>,
    title: &str,
    row: &tokio_postgres::Row,
) -> Result<ManualCandidateContext, InputRepositoryError> {
    let invalid = || InputRepositoryError::InputContract("manual radar input is invalid");
    let value: Option<serde_json::Value> = row.try_get(9)?;
    let input: RadarManualInput =
        serde_json::from_value(value.ok_or_else(invalid)?).map_err(|_invalid| invalid())?;
    radar::validate_manual_input(&input).map_err(|_invalid| invalid())?;
    let source_basis_id: String = row.try_get::<_, Option<String>>(10)?.ok_or_else(invalid)?;
    // Editing only needs the immutable criteria, not a possibly expired generation snapshot.
    let saved = tx.query_opt(
        "SELECT payload,checksum FROM series_radar_bases WHERE id=$1 AND game_title_id=$2 AND octet_length(payload::text)<=$3",
        &[&source_basis_id,&title,&STORED_PAYLOAD_BOUND],
    ).await?.ok_or_else(invalid)?;
    let source_basis = decode_basis(&saved.try_get(0)?, &saved.try_get::<_, String>(1)?, title)?;
    Ok(ManualCandidateContext {
        input,
        source_basis_id,
        source_candidate_id: row.try_get(11)?,
        source_basis,
    })
}

fn decode_basis(
    value: &serde_json::Value,
    checksum: &str,
    title: &str,
) -> Result<RadarBasis, InputRepositoryError> {
    let invalid = || InputRepositoryError::InputContract("radar basis is invalid");
    let basis = momo_analysis_core::payload::radar_basis_from_payload(value)
        .map_err(|_invalid| invalid())?;
    if basis.source.game_title_id != title
        || basis.checksum().map_err(|_invalid| invalid())? != checksum
    {
        return Err(invalid());
    }
    Ok(basis)
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
    let basis = decode_basis(&row.try_get(0)?, &row.try_get::<_, String>(2)?, title)?;
    let source: Option<RadarSourceSnapshot> = row
        .try_get::<_, Option<serde_json::Value>>(1)?
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_error| invalid())?;
    if basis.source.game_title_id != title
        || source
            .as_ref()
            .is_none_or(|source| source.summary().ok().as_ref() != Some(basis.monitoring_source()))
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) manual_basis: Option<RadarBasis>,
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
    pub(super) before_achievements: AchievementPreview,
    pub(super) after_achievements: AchievementPreview,
}

fn achievement_preview(
    achievements: &AchievementPayload,
    scope: &ScopeRef,
    basis: Option<&RadarBasis>,
    fallback_curve: Option<AchievementCurve>,
) -> Result<AchievementPreview, radar::RadarError> {
    let map_id = match scope {
        ScopeRef::Map { map_master_id } | ScopeRef::SeasonMap { map_master_id, .. } => {
            Some(map_master_id)
        }
        ScopeRef::Overall | ScopeRef::Season { .. } => None,
    };
    let summary = achievements
        .summaries
        .iter()
        .find(|summary| summary.map_master_id.as_ref() == map_id)
        .ok_or(radar::RadarError::InvalidSource)?;
    Ok(AchievementPreview::new(
        summary,
        basis.map_or_else(
            || fallback_curve.unwrap_or_default(),
            RadarBasis::effective_achievement_curve,
        ),
    ))
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
    let manual_basis = context.new_manual_basis(input)?;
    let basis = candidate
        .as_ref()
        .and_then(|c| c.basis.as_ref())
        .or(manual_basis.as_ref())
        .or(context.basis.as_ref());
    let source_valid = if context.is_manual() {
        true
    } else if let Some(source) = context.source.as_ref() {
        radar::source_is_current(source, input)?
    } else {
        candidate.is_some()
    };
    let before = radar::evaluate_scopes(input, context.before_basis.as_ref())?;
    let after = radar::evaluate_scopes(input, basis)?;
    let achievements = achievements::calculate(
        input.game_title_id(),
        input.achievements(),
        input.player_matches(),
        AchievementCurve::default(),
    );
    let scopes = before
        .into_iter()
        .zip(after)
        .map(|((scope, before), (_, after))| {
            Ok(PreparationScope {
                payload: PreviewPayload {
                    before,
                    after,
                    before_achievements: achievement_preview(
                        &achievements,
                        &scope,
                        context.before_basis.as_ref(),
                        None,
                    )?,
                    after_achievements: achievement_preview(
                        &achievements,
                        &scope,
                        basis,
                        candidate
                            .as_ref()
                            .and_then(|c| c.achievement_generation.as_deref())
                            .map(radar::AchievementGeneration::curve),
                    )?,
                },
                scope,
            })
        })
        .collect::<Result<Vec<_>, radar::RadarError>>()?;
    let mut evaluation_snapshot = radar::snapshot(input)?;
    evaluation_snapshot.achievements = Some(Box::new(achievements));
    Ok(Preparation {
        schema_version: 2,
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
        manual_basis,
        evaluation_snapshot,
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
