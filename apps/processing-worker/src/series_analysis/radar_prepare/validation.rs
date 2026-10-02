use momo_analysis_core::{
    model::NormalizedAnalysisInput,
    payload,
    radar::{self, RadarBasis, RadarError},
};

use super::{Preparation, RadarReadContext};

/// Rechecks the frozen source, complete scope set, shared raw values, and saved scoring criteria.
/// Calculation-source validity against *current* records is checked separately under the
/// publication fence. The child's old boolean is not evidence of current validity.
pub(in crate::series_analysis) fn validate(
    prepared: &Preparation,
    context: &RadarReadContext,
    before_basis: Option<&RadarBasis>,
) -> Result<NormalizedAnalysisInput, RadarError> {
    if prepared.schema_version != 1
        || context.work_kind != "radar_prepare"
        || context.operation_id.as_deref() != Some(prepared.operation_id.as_str())
        || context.candidate_id.as_deref() != Some(prepared.candidate_id.as_str())
        || context.preview_id != prepared.preview_id
        || (context.operation_kind.as_deref() == Some("candidate")) != prepared.candidate.is_some()
        || !matches!(
            context.operation_kind.as_deref(),
            Some("candidate" | "preview" | "restore")
        )
        || prepared.game_title_id != prepared.evaluation_snapshot.game_title_id
        || prepared.before_basis_id.is_some() != before_basis.is_some()
    {
        return Err(RadarError::InvalidSource);
    }
    let input = prepared
        .evaluation_snapshot
        .normalized_for_validation(prepared.input_revision)?;
    let basis = if let Some(candidate) = &prepared.candidate {
        let value = serde_json::to_value(candidate.summary())
            .map_err(|_encoding| RadarError::InvalidSource)?;
        payload::radar_candidate_from_payload(&value)
            .map_err(|_invalid| RadarError::InvalidSource)?;
        if candidate.source != prepared.evaluation_snapshot
            || candidate.source.summary()? != candidate.source_summary
            || !prepared.candidate_source_valid
        {
            return Err(RadarError::InvalidSource);
        }
        candidate.basis.as_ref()
    } else {
        let source = context.source.as_ref().ok_or(RadarError::InvalidSource)?;
        if radar::source_is_current(source, &input)? != prepared.candidate_source_valid {
            return Err(RadarError::InvalidSource);
        }
        context.basis.as_ref()
    };
    let before = radar::evaluate_scopes(&input, before_basis)?;
    let after = radar::evaluate_scopes(&input, basis)?;
    if prepared.scopes.len() != before.len()
        || prepared
            .scopes
            .iter()
            .zip(before.into_iter().zip(after))
            .any(|(actual, ((before_scope, before), (after_scope, after)))| {
                actual.scope != before_scope
                    || actual.scope != after_scope
                    || actual.payload.before != before
                    || actual.payload.after != after
            })
    {
        return Err(RadarError::InvalidSource);
    }
    Ok(input)
}
