use std::collections::{BTreeMap, BTreeSet};

const SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD: f64 = 0.6;
const SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD: f64 = 0.75;

#[derive(Clone, Debug)]
pub(crate) struct PsmAttempt {
    pub(crate) text: String,
    pub(crate) count: Option<u32>,
    pub(crate) confidence: Option<f64>,
}

#[derive(Clone, Debug)]
pub(crate) struct CountRecognition {
    pub(crate) raw_text: String,
    pub(crate) count: Option<u32>,
    pub(crate) confidence: Option<f64>,
}

pub(crate) fn parse_count(value: &str) -> Option<u32> {
    if matches!(value.trim(), "|" | "｜") {
        return Some(1);
    }
    for candidate in value.split('|').rev() {
        let digits: String = candidate.chars().filter_map(count_alias).collect();
        if !digits.is_empty() {
            if digits.len() > 1 && digits.starts_with('0') {
                return Some(0);
            }
            if let Ok(count) = digits.parse::<u32>() {
                return Some(count);
            }
        }
    }
    None
}

pub(crate) fn is_pure_pipe_noise(value: &str) -> bool {
    let cleaned = value.trim();
    !cleaned.is_empty()
        && cleaned
            .chars()
            .all(|character| character.is_whitespace() || "|｜Ili".contains(character))
}

pub(crate) fn vote_count(attempts: &[PsmAttempt]) -> (Option<u32>, Option<f64>) {
    let groups = group_attempts(attempts);
    let Some((count, group)) = groups
        .iter()
        .min_by(|left, right| compare_attempt_groups(left, right))
    else {
        return (None, None);
    };
    (
        Some(*count),
        maximum_confidence(group.iter().map(|attempt| attempt.confidence)),
    )
}

pub(crate) fn select_count_recognition(
    primary: &CountRecognition,
    fallbacks: &[CountRecognition],
    maximum_plausible_count: u32,
) -> CountRecognition {
    let mut candidates = Vec::with_capacity(fallbacks.len().saturating_add(1));
    candidates.push(primary.clone());
    candidates.extend_from_slice(fallbacks);
    let raw_text = combined_raw_text(&candidates);
    let valid: Vec<&CountRecognition> = candidates
        .iter()
        .filter(|result| result.count.is_some())
        .collect();
    if valid.is_empty() {
        return recognition(raw_text, None, None);
    }
    let plausible: Vec<&CountRecognition> = valid
        .iter()
        .copied()
        .filter(|result| {
            result
                .count
                .is_some_and(|count| count <= maximum_plausible_count)
        })
        .collect();
    if let Some((count, confidence)) = recover(
        primary,
        fallbacks,
        &valid,
        &plausible,
        maximum_plausible_count,
    ) {
        return recognition(raw_text, Some(count), confidence);
    }
    let pool = if plausible.is_empty() {
        &valid
    } else {
        &plausible
    };
    let groups = group_recognitions(pool);
    let Some((count, group)) = groups
        .iter()
        .min_by(|left, right| compare_recognition_groups(left, right))
    else {
        return recognition(raw_text, None, None);
    };
    recognition(
        raw_text,
        Some(*count),
        attenuated_confidence(group, pool.len()),
    )
}

fn recover(
    primary: &CountRecognition,
    fallbacks: &[CountRecognition],
    valid: &[&CountRecognition],
    plausible: &[&CountRecognition],
    maximum_plausible_count: u32,
) -> Option<(u32, Option<f64>)> {
    if plausible.is_empty()
        && let Some(recovered) = recover_common_leading_digit(valid, maximum_plausible_count)
    {
        return Some(recovered);
    }
    if let Some(recovered) = recover_otsu_zero_alias(primary, fallbacks, maximum_plausible_count) {
        return Some(recovered);
    }
    recover_weak_seven_alias(primary, fallbacks, maximum_plausible_count)
}

fn recover_common_leading_digit(
    valid: &[&CountRecognition],
    maximum_plausible_count: u32,
) -> Option<(u32, Option<f64>)> {
    let candidates: Vec<(u32, Option<f64>)> = valid
        .iter()
        .filter_map(|result| {
            if result
                .count
                .is_none_or(|count| count <= maximum_plausible_count)
            {
                return None;
            }
            leading_digit_candidate(result, maximum_plausible_count)
        })
        .collect();
    let first = candidates.first()?.0;
    if candidates.iter().any(|(digit, _)| *digit != first) {
        return None;
    }
    Some((
        first,
        maximum_confidence(candidates.iter().map(|(_, confidence)| *confidence)),
    ))
}

fn recover_otsu_zero_alias(
    primary: &CountRecognition,
    fallbacks: &[CountRecognition],
    maximum_plausible_count: u32,
) -> Option<(u32, Option<f64>)> {
    let [sharpened, otsu, ..] = fallbacks else {
        return None;
    };
    let otsu_count = single_plausible_nonzero_digit(otsu, maximum_plausible_count)?;
    let sharpened_count = single_plausible_nonzero_digit(sharpened, maximum_plausible_count)?;
    if primary.count == Some(0)
        && !primary
            .raw_text
            .chars()
            .any(|character| character.is_ascii_digit())
        && otsu_count != sharpened_count
        && sharpened.confidence.unwrap_or(0.0) < SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD
    {
        Some((otsu_count, otsu.confidence))
    } else {
        None
    }
}

fn recover_weak_seven_alias(
    primary: &CountRecognition,
    fallbacks: &[CountRecognition],
    maximum_plausible_count: u32,
) -> Option<(u32, Option<f64>)> {
    if maximum_plausible_count < 7 {
        return None;
    }
    let [sharpened, otsu, ..] = fallbacks else {
        return None;
    };
    if !has_exact_piece(otsu, 1) {
        return None;
    }
    let non_otsu = [primary, sharpened];
    let seven_candidates: Vec<&CountRecognition> = non_otsu
        .iter()
        .copied()
        .filter(|result| result.count == Some(7))
        .collect();
    let has_other_digit = non_otsu
        .iter()
        .any(|result| result.count.is_some_and(|count| count != 7));
    let seven_confidence =
        maximum_confidence(seven_candidates.iter().map(|result| result.confidence)).unwrap_or(0.0);
    if !seven_candidates.is_empty()
        && !has_other_digit
        && seven_confidence <= SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD
    {
        Some((1, otsu.confidence))
    } else {
        None
    }
}

fn leading_digit_candidate(
    result: &CountRecognition,
    maximum_plausible_count: u32,
) -> Option<(u32, Option<f64>)> {
    text_pieces(&result.raw_text).find_map(|piece| {
        let digits: String = piece.chars().filter(char::is_ascii_digit).collect();
        if digits.len() <= 1 {
            return None;
        }
        let leading = digits.chars().next()?.to_digit(10)?;
        (leading > 0 && leading <= maximum_plausible_count).then_some((leading, result.confidence))
    })
}

fn single_plausible_nonzero_digit(
    result: &CountRecognition,
    maximum_plausible_count: u32,
) -> Option<u32> {
    let count = result.count?;
    if count == 0 || count > maximum_plausible_count.min(9) || !has_exact_piece(result, count) {
        return None;
    }
    Some(count)
}

fn has_exact_piece(result: &CountRecognition, count: u32) -> bool {
    let expected = count.to_string();
    text_pieces(&result.raw_text).any(|piece| piece == expected)
}

fn group_attempts(attempts: &[PsmAttempt]) -> BTreeMap<u32, Vec<&PsmAttempt>> {
    let mut grouped: BTreeMap<u32, Vec<&PsmAttempt>> = BTreeMap::new();
    for attempt in attempts {
        if let Some(count) = attempt.count {
            grouped.entry(count).or_default().push(attempt);
        }
    }
    grouped
}

fn group_recognitions<'a>(
    results: &'a [&'a CountRecognition],
) -> BTreeMap<u32, Vec<&'a CountRecognition>> {
    let mut grouped: BTreeMap<u32, Vec<&CountRecognition>> = BTreeMap::new();
    for result in results {
        if let Some(count) = result.count {
            grouped.entry(count).or_default().push(*result);
        }
    }
    grouped
}

fn compare_attempt_groups(
    left: &(&u32, &Vec<&PsmAttempt>),
    right: &(&u32, &Vec<&PsmAttempt>),
) -> std::cmp::Ordering {
    compare_group_keys(
        attempt_group_key(*left.0, left.1),
        attempt_group_key(*right.0, right.1),
    )
}

fn compare_recognition_groups(
    left: &(&u32, &Vec<&CountRecognition>),
    right: &(&u32, &Vec<&CountRecognition>),
) -> std::cmp::Ordering {
    compare_group_keys(
        recognition_group_key(*left.0, left.1),
        recognition_group_key(*right.0, right.1),
    )
}

fn attempt_group_key(count: u32, group: &[&PsmAttempt]) -> (bool, usize, f64, usize, u32) {
    (
        group.iter().any(|attempt| {
            attempt
                .text
                .chars()
                .any(|character| character.is_ascii_digit())
        }),
        group.len(),
        maximum_confidence(group.iter().map(|attempt| attempt.confidence)).unwrap_or(0.0),
        group
            .iter()
            .map(|attempt| attempt.text.len())
            .min()
            .unwrap_or(usize::MAX),
        count,
    )
}

fn recognition_group_key(
    count: u32,
    group: &[&CountRecognition],
) -> (bool, usize, f64, usize, u32) {
    (
        group.iter().any(|result| {
            text_pieces(&result.raw_text)
                .any(|piece| piece.chars().any(|character| character.is_ascii_digit()))
        }),
        group.len(),
        maximum_confidence(group.iter().map(|result| result.confidence)).unwrap_or(0.0),
        group
            .iter()
            .map(|result| {
                text_pieces(&result.raw_text)
                    .map(str::len)
                    .min()
                    .unwrap_or(result.raw_text.len())
            })
            .min()
            .unwrap_or(usize::MAX),
        count,
    )
}

fn compare_group_keys(
    left: (bool, usize, f64, usize, u32),
    right: (bool, usize, f64, usize, u32),
) -> std::cmp::Ordering {
    right
        .0
        .cmp(&left.0)
        .then_with(|| right.1.cmp(&left.1))
        .then_with(|| right.2.total_cmp(&left.2))
        .then_with(|| left.3.cmp(&right.3))
        .then_with(|| left.4.cmp(&right.4))
}

fn attenuated_confidence(group: &[&CountRecognition], pool_size: usize) -> Option<f64> {
    let base = maximum_confidence(group.iter().map(|result| result.confidence))?;
    let group_size = u32::try_from(group.len()).ok()?;
    let pool_size = u32::try_from(pool_size.max(1)).ok()?;
    let agreement = f64::from(group_size) / f64::from(pool_size);
    Some(base * 0.5_f64.mul_add(agreement, 0.5))
}

fn maximum_confidence(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    values.flatten().max_by(f64::total_cmp)
}

fn combined_raw_text(candidates: &[CountRecognition]) -> String {
    let mut seen = BTreeSet::new();
    candidates
        .iter()
        .filter_map(|candidate| {
            if candidate.raw_text.is_empty() || !seen.insert(candidate.raw_text.clone()) {
                None
            } else {
                Some(candidate.raw_text.as_str())
            }
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

const fn recognition(
    raw_text: String,
    count: Option<u32>,
    confidence: Option<f64>,
) -> CountRecognition {
    CountRecognition {
        raw_text,
        count,
        confidence,
    }
}

fn text_pieces(value: &str) -> impl Iterator<Item = &str> {
    value
        .split('|')
        .map(str::trim)
        .filter(|piece| !piece.is_empty())
}

const fn count_alias(character: char) -> Option<char> {
    if character.is_ascii_digit() {
        return Some(character);
    }
    match character {
        'Ｏ' | 'O' | 'o' | 'ｏ' => Some('0'),
        'I' | 'l' | 'i' | '｜' => Some('1'),
        _ => None,
    }
}
