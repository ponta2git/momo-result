//! Encodes shared JSON references and evidence used by analysis resources.

use serde_json::{Value, json};

use crate::{contract::ScopeRef, stats::quality_status};

pub(super) fn metric_evidence_json(
    metric_id: &str,
    unit: &str,
    value: Option<f64>,
    denominator: Option<usize>,
) -> Value {
    json!({ "metricId": metric_id, "unit": unit, "value": value, "denominator": denominator, "qualityStatus": denominator.map_or("ok", quality_status) })
}

pub(super) fn scope_summary_json(scope: &ScopeRef, match_count: usize) -> Value {
    let mut value = scope.json_value();
    if let Some(object) = value.as_object_mut() {
        object.insert("matchCount".into(), json!(match_count));
    }
    value
}

pub(super) fn member_ref_json(member_id: &str) -> Value {
    json!({ "memberId": member_id })
}
