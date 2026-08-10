use serde_json::{Value, json};

use crate::stats::round;

use super::{
    Candidate, Category, CommonTopic, PRIMARY_CONDITIONAL_COUNT,
    template::{symptom_metric, template},
};

pub(super) fn candidate_json(candidate: &Candidate) -> Value {
    let template = template(candidate.category, candidate.contrast.driver);
    let quality = conditional_quality_status(candidate.target_count);
    let stability = stability_band(candidate.target_count, candidate.contrast.effect);
    let classification = classification(candidate);
    let symptom_metric = symptom_metric(candidate.category);
    let symptom_unit = if candidate.category == Category::Revenue {
        "rate"
    } else {
        "score"
    };
    let data_reason = format!(
        "対象は{}件。条件内の値が本人の通常時と異なり、{}も入賞側と下位側で差が残った候補です。件数が少ない場合は、結論ではなく次戦で確かめる仮説として扱います。",
        candidate.target_count,
        candidate.contrast.driver.label(),
    );
    json!({
        "cardId": format!("playbook:{}:{}", candidate.member_id, candidate.category.code()),
        "classification": classification,
        "category": candidate.category.code(),
        "heading": template.heading,
        "actionHypothesis": template.hypothesis,
        "triggerCondition": template.trigger,
        "recommendedAction": template.recommended,
        "avoidAction": template.avoid,
        "dataReason": data_reason,
        "postMatchCheck": template.post_match,
        "plainReason": format!("{}で、入賞側と下位側の差が確認できる候補です。", candidate.contrast.driver.label()),
        "evidenceStrength": evidence_strength(candidate.target_count),
        "targetCount": candidate.target_count,
        "evidence": [
            {
                "metricId": symptom_metric,
                "label": "条件内と本人基準の差",
                "unit": symptom_unit,
                "value": round(candidate.raw_symptom, 6),
                "denominator": candidate.baseline_count,
                "targetCount": candidate.target_count,
                "qualityStatus": quality,
                "stabilityBand": stability,
            },
            {
                "metricId": candidate.contrast.driver.metric_id(),
                "label": candidate.contrast.driver.label(),
                "unit": candidate.contrast.driver.unit(),
                "value": round(candidate.contrast.mean_difference, 6),
                "effectEstimate": round(candidate.contrast.effect, 6),
                "denominator": candidate.target_count,
                "targetCount": candidate.target_count,
                "supportCount": candidate.contrast.positive_count.min(candidate.contrast.negative_count),
                "qualityStatus": quality,
                "stabilityBand": stability,
            }
        ],
        "qualityStatus": quality,
        "stabilityBand": stability,
        "supportCount": candidate.contrast.positive_count.min(candidate.contrast.negative_count),
        "anchorTarget": {
            "view": template.view,
            "sectionId": template.section_id,
            "label": template.anchor_label,
        },
        "actionAdviceScore": candidate.action_advice_score,
    })
}

pub(super) fn common_topic_json(topic: &CommonTopic) -> Value {
    json!({
        "topicId": format!("common:{}", topic.category.code()),
        "category": topic.category.code(),
        "heading": topic.category.common_heading(),
        "detail": format!("{}に同じ論点が出たため、個人カードには4人内で差が強い候補だけを残しています。", topic.candidate_count),
        "playerIds": topic.player_ids,
    })
}

fn classification(candidate: &Candidate) -> &'static str {
    if candidate.target_count < PRIMARY_CONDITIONAL_COUNT || candidate.contrast.effect < 0.50 {
        "verify"
    } else if candidate.normalized_symptom < 0.0 {
        "revise"
    } else {
        "reproduce"
    }
}

pub(super) const fn conditional_quality_status(target_count: usize) -> &'static str {
    if target_count == 0 {
        "no_target"
    } else if target_count < PRIMARY_CONDITIONAL_COUNT {
        "reference"
    } else {
        "ok"
    }
}

const fn evidence_strength(target_count: usize) -> &'static str {
    if target_count >= 20 {
        "high"
    } else if target_count >= PRIMARY_CONDITIONAL_COUNT {
        "medium"
    } else {
        "low"
    }
}

fn stability_band(target_count: usize, effect: f64) -> &'static str {
    if target_count >= 20 && effect >= 0.50 {
        "high"
    } else if target_count >= PRIMARY_CONDITIONAL_COUNT {
        "medium"
    } else {
        "low"
    }
}
