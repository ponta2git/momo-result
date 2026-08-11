use std::sync::LazyLock;

use regex::Regex;

const MINUS_SIGNS: &str = "-−ー一–—‐";

static MONEY_PATTERN: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(
        r"(?P<sign>[-−ー一–—‐])?\s*(?:(?P<oku>[0-9]+)\s*億\s*(?:(?P<oku_man>[0-9]+)\s*万\s*)?|(?P<man>[0-9]+)\s*万\s*|(?P<bare>[0-9]+)\s*)[円口幅]",
    )
    .ok()
});
static PARTIAL_OKU_PATTERN: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?P<sign>[-−ー一–—‐])?\s*(?P<oku>[0-9]+)\s*億\s*(?P<man>[0-9]{3,4})").ok()
});
static DIGIT_FALLBACK_PATTERN: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"[0-9]{5,8}").ok());
static MINUS_ONE_HUNDREDS_PATTERN: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?P<sign>[-−ー一–—‐])\s*[\]}]\s*(?P<rest>[0-9]{2})\s*万").ok());

#[derive(Clone, Copy)]
struct Candidate {
    amount: i64,
    score: u8,
}

pub(crate) fn parse_money_man_yen(value: &str) -> Option<i64> {
    let normalized = normalize_units(value).replace([',', '，'], "");
    let mut candidates = unit_candidates(&normalized);
    candidates.extend(partial_oku_candidates(&normalized));
    if !candidates.iter().any(|candidate| candidate.amount != 0) {
        candidates.extend(digit_fallback_candidates(&normalized));
    }
    select_candidate(&candidates)
}

pub(crate) fn parse_revenue_man_yen(value: &str) -> Option<i64> {
    parse_money_man_yen(value).or_else(|| zero_revenue_alias(value).then_some(0))
}

pub(crate) fn has_unit_bearing_money_text(value: &str) -> bool {
    let normalized = normalize_units(value).replace([',', '，'], "");
    MONEY_PATTERN
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(&normalized))
}

fn unit_candidates(value: &str) -> Vec<Candidate> {
    let Some(pattern) = MONEY_PATTERN.as_ref() else {
        return Vec::new();
    };
    pattern
        .captures_iter(value)
        .filter_map(|captures| {
            let matched = captures.iter().next().flatten()?;
            let sign = sign_for_match(value, matched.start(), captures.name("sign"));
            let oku = capture_integer(&captures, "oku");
            let oku_man = capture_integer(&captures, "oku_man");
            let man = capture_integer(&captures, "man");
            let bare = capture_integer(&captures, "bare");
            match (oku, oku_man, man, bare) {
                (Some(oku_value), Some(man_value), None, None) => Some(Candidate {
                    amount: sign * (oku_value.checked_mul(10_000)?.checked_add(man_value)?),
                    score: 4,
                }),
                (Some(oku_value), None, None, None) => Some(Candidate {
                    amount: sign * oku_value.checked_mul(10_000)?,
                    score: 3,
                }),
                (None, None, Some(man_value), None) => Some(Candidate {
                    amount: sign * man_value,
                    score: 2,
                }),
                (None, None, None, Some(bare_value)) => Some(Candidate {
                    amount: sign * bare_value,
                    score: 1,
                }),
                _ => None,
            }
        })
        .collect()
}

fn partial_oku_candidates(value: &str) -> Vec<Candidate> {
    let Some(pattern) = PARTIAL_OKU_PATTERN.as_ref() else {
        return Vec::new();
    };
    pattern
        .captures_iter(value)
        .filter_map(|captures| {
            let matched = captures.iter().next().flatten()?;
            if value
                .get(matched.end()..)
                .and_then(|suffix| suffix.chars().next())
                .is_some_and(|character| character.is_ascii_digit())
            {
                return None;
            }
            let sign = sign_for_match(value, matched.start(), captures.name("sign"));
            let oku = capture_integer(&captures, "oku")?;
            let man = capture_integer(&captures, "man")?;
            Some(Candidate {
                amount: sign * oku.checked_mul(10_000)?.checked_add(man)?,
                score: 3,
            })
        })
        .collect()
}

fn digit_fallback_candidates(value: &str) -> Vec<Candidate> {
    let Some(pattern) = DIGIT_FALLBACK_PATTERN.as_ref() else {
        return Vec::new();
    };
    pattern
        .find_iter(value)
        .filter_map(|matched| {
            let bounded_left = value
                .get(..matched.start())
                .and_then(|prefix| prefix.chars().next_back())
                .is_none_or(|character| !character.is_ascii_digit());
            let bounded_right = value
                .get(matched.end()..)
                .and_then(|suffix| suffix.chars().next())
                .is_none_or(|character| !character.is_ascii_digit());
            if !bounded_left || !bounded_right {
                return None;
            }
            let digits = matched.as_str();
            let retained = if digits.len() >= 7 {
                digits.get(..digits.len().saturating_sub(2))?
            } else {
                digits.get(..digits.len().saturating_sub(1))?
            };
            retained
                .parse::<i64>()
                .ok()
                .map(|amount| Candidate { amount, score: 0 })
        })
        .collect()
}

fn capture_integer(captures: &regex::Captures<'_>, name: &str) -> Option<i64> {
    captures.name(name)?.as_str().parse::<i64>().ok()
}

fn sign_for_match(value: &str, start: usize, sign_match: Option<regex::Match<'_>>) -> i64 {
    let Some(sign_match) = sign_match else {
        return 1;
    };
    let previous = value
        .get(..start)
        .and_then(|prefix| prefix.chars().next_back());
    if previous.is_some_and(is_name_letter) || !MINUS_SIGNS.contains(sign_match.as_str()) {
        1
    } else {
        -1
    }
}

fn normalize_units(value: &str) -> String {
    let characters: Vec<char> = value.chars().collect();
    let mut normalized = String::with_capacity(value.len());
    for (index, character) in characters.iter().copied().enumerate() {
        let previous = nearest_nonspace(&characters, index, false);
        let next = nearest_nonspace(&characters, index, true);
        let replacement = if matches!(character, '借' | '信' | '僧')
            && previous.is_some_and(|item| item.is_ascii_digit())
            && next.is_some_and(|item| item.is_ascii_digit())
        {
            '億'
        } else if matches!(character, '口' | '幅')
            && previous.is_some_and(|item| item.is_ascii_digit())
        {
            '円'
        } else {
            character
        };
        normalized.push(replacement);
    }
    for sign in MINUS_SIGNS.chars() {
        normalized = normalized
            .replace(&format!("{sign}ら"), &format!("{sign}5"))
            .replace(&format!("{sign} ら"), &format!("{sign} 5"));
    }
    normalized = normalized.replace("億/", "億7").replace("億／", "億7");
    if let Some(pattern) = MINUS_ONE_HUNDREDS_PATTERN.as_ref() {
        normalized = pattern
            .replace_all(&normalized, |captures: &regex::Captures<'_>| {
                let sign = captures.name("sign").map_or("", |matched| matched.as_str());
                let rest = captures.name("rest").map_or("", |matched| matched.as_str());
                format!("{sign}1{rest}万")
            })
            .into_owned();
    }
    normalized
}

fn nearest_nonspace(characters: &[char], index: usize, forward: bool) -> Option<char> {
    if forward {
        characters
            .iter()
            .skip(index.saturating_add(1))
            .copied()
            .find(|character| !character.is_whitespace())
    } else {
        characters
            .iter()
            .take(index)
            .rev()
            .copied()
            .find(|character| !character.is_whitespace())
    }
}

fn select_candidate(candidates: &[Candidate]) -> Option<i64> {
    let has_nonzero = candidates.iter().any(|candidate| candidate.amount != 0);
    let mut best: Option<(i64, usize, u8)> = None;
    for candidate in candidates
        .iter()
        .filter(|candidate| !has_nonzero || candidate.amount != 0)
    {
        if best.is_some_and(|(amount, _, _)| amount == candidate.amount) {
            continue;
        }
        let count = candidates
            .iter()
            .filter(|other| (!has_nonzero || other.amount != 0) && other.amount == candidate.amount)
            .count();
        let score = candidates
            .iter()
            .filter(|other| other.amount == candidate.amount)
            .map(|other| other.score)
            .max()
            .unwrap_or(0);
        if best.is_none_or(|(_, best_count, best_score)| (count, score) > (best_count, best_score))
        {
            best = Some((candidate.amount, count, score));
        }
    }
    best.map(|(amount, _, _)| amount)
}

fn zero_revenue_alias(value: &str) -> bool {
    value.match_indices("社長").any(|(index, marker)| {
        let suffix_start = index.saturating_add(marker.len());
        let suffix: String = value
            .get(suffix_start..)
            .unwrap_or_default()
            .chars()
            .take(20)
            .collect();
        let lower = suffix.to_ascii_lowercase();
        (lower.contains('0') || lower.contains('o'))
            && (lower.contains('f')
                || lower.contains('n')
                || lower.contains('m')
                || suffix
                    .chars()
                    .any(|character| "万円口幅".contains(character)))
    })
}

fn is_name_letter(character: char) -> bool {
    character.is_ascii_alphabetic()
        || ('ぁ'..='ん').contains(&character)
        || ('ァ'..='ヴ').contains(&character)
        || ('一'..='龥').contains(&character)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranked_early_stop_requires_unit_bearing_money_evidence() {
        assert!(!has_unit_bearing_money_text("いーゆー社長 41841204"));
        assert!(has_unit_bearing_money_text("いーゆー社長 4億4120万円"));
    }

    #[test]
    fn bounded_glyph_repairs_preserve_game_money_units() {
        assert_eq!(parse_money_man_yen("NO11社長 2億/600万円"), Some(27_600));
        assert_eq!(parse_money_man_yen("ぽんた社長 -] 00万円"), Some(-100));
    }
}
