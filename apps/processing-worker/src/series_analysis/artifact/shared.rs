use serde_json::Value;

use momo_analysis_core::contract::{CommonResource, ResourceManifest};

pub(super) const MANIFEST_FILE_NAME: &str = "manifest.json";

pub(super) const fn resource_common(resource: &ResourceManifest) -> &CommonResource {
    match resource {
        ResourceManifest::Aggregate { common }
        | ResourceManifest::Review { common }
        | ResourceManifest::Drilldown { common, .. }
        | ResourceManifest::MatchContext { common, .. } => common,
    }
}

pub(super) fn nesting_depth(value: &Value) -> u32 {
    match value {
        Value::Array(values) => 1 + values.iter().map(nesting_depth).max().unwrap_or(0),
        Value::Object(values) => 1 + values.values().map(nesting_depth).max().unwrap_or(0),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => 1,
    }
}
