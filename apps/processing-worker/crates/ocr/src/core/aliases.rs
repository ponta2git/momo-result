use unicode_normalization::UnicodeNormalization;

use crate::contract::OcrHints;

const MINIMUM_SAFE_ALIAS_CHARACTERS: usize = 5;
const MINIMUM_MATCH_CHARACTERS: usize = 3;
const MINIMUM_NAME_SIMILARITY: f64 = 0.65;

const STATIC_ALIASES: [(&str, &[&str]); 5] = [
    ("NO11社長", &["NO11社長"]),
    (
        "オータカ社長",
        &[
            "オータカ社長",
            "おーたか社長",
            "おたか社長",
            "オー夕カ社長",
            "コーツ力社長",
        ],
    ),
    (
        "いーゆー社長",
        &["いーゆー社長", "ローゆー社長", "いーばゆー社長"],
    ),
    (
        "ぽんた社長",
        &["ぽんた社長", "ほんた社長", "ぼんた社長", "ばんた社長"],
    ),
    ("さくま社長", &["さくま社長", "さくぐま社長"]),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PlayerIdentity {
    pub(crate) display_name: Option<String>,
    pub(crate) member_id: Option<String>,
}

#[derive(Clone, Debug)]
struct AliasPair {
    display_name: String,
    surface: String,
    member_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AliasResolver {
    pairs: Vec<AliasPair>,
}

impl AliasResolver {
    pub(crate) fn from_hints(hints: &OcrHints) -> Self {
        let mut pairs = Vec::new();
        for (display_name, surfaces) in STATIC_ALIASES {
            for surface in surfaces {
                append_pair(
                    &mut pairs,
                    AliasPair {
                        display_name: String::from(display_name),
                        surface: String::from(*surface),
                        member_id: None,
                    },
                );
            }
        }
        for hint in hints.known_player_aliases() {
            let display_name = hint
                .aliases()
                .iter()
                .find(|alias| identifiable_name(&normalize_name(alias)))
                .cloned()
                .unwrap_or_else(|| String::from(hint.member_id()));
            for alias in hint.aliases() {
                append_pair(
                    &mut pairs,
                    AliasPair {
                        display_name: display_name.clone(),
                        surface: alias.clone(),
                        member_id: Some(String::from(hint.member_id())),
                    },
                );
            }
        }
        for alias in hints.computer_player_aliases() {
            append_pair(
                &mut pairs,
                AliasPair {
                    display_name: String::from("さくま社長"),
                    surface: String::from(alias),
                    member_id: None,
                },
            );
        }
        Self { pairs }
    }

    pub(crate) fn extract(&self, text: &str) -> PlayerIdentity {
        let normalized = normalize_name(text);
        if let Some(pair) = self
            .pairs
            .iter()
            .find(|pair| normalized.contains(&pair.surface))
        {
            return PlayerIdentity {
                display_name: Some(pair.display_name.clone()),
                member_id: pair.member_id.clone(),
            };
        }
        PlayerIdentity {
            display_name: extract_president_name(text),
            member_id: None,
        }
    }
}

pub(crate) fn names_match(left: &str, right: &str) -> bool {
    let normalized_left = normalize_name(left);
    let normalized_right = normalize_name(right);
    if !identifiable_name(&normalized_left) || !identifiable_name(&normalized_right) {
        return false;
    }
    let left_core = remove_long_vowels(strip_president(&normalized_left));
    let right_core = remove_long_vowels(strip_president(&normalized_right));
    normalized_left.contains(&normalized_right)
        || normalized_right.contains(&normalized_left)
        || normalized_right.contains(strip_president(&normalized_left))
        || left_core.contains(&right_core)
        || right_core.contains(&left_core)
        || lcs_ratio(&left_core, &right_core) >= MINIMUM_NAME_SIMILARITY
}

pub(crate) fn normalize_name(value: &str) -> String {
    let normalized: String = value.nfkc().collect();
    let corrected = normalized
        .replace(['_', '一', '-'], "ー")
        .replace("N011", "NO11")
        .replace("n011", "no11")
        .replace("いローゆ", "いーゆ")
        .replace("いハーゆ", "いーゆ")
        .replace("いーばゆ", "いーゆ")
        .replace("いー了ゆ", "いーゆ")
        .replace("ローゆ", "いーゆ")
        .replace("ハーゆ", "いーゆ")
        .replace("バーゆ", "いーゆ")
        .replace("コーツ力", "オータカ");
    let cleaned: String = corrected
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || ('ぁ'..='ん').contains(character)
                || ('ァ'..='ン').contains(character)
                || ('一'..='龥').contains(character)
                || *character == 'ー'
        })
        .flat_map(char::to_lowercase)
        .collect();
    cleaned.replace("n011", "no11")
}

fn append_pair(pairs: &mut Vec<AliasPair>, mut candidate: AliasPair) {
    candidate.surface = normalize_name(&candidate.surface);
    if candidate.surface.chars().count() < MINIMUM_SAFE_ALIAS_CHARACTERS
        || !identifiable_name(&candidate.surface)
    {
        return;
    }
    if !pairs.iter().any(|current| {
        current.display_name == candidate.display_name
            && current.surface == candidate.surface
            && current.member_id == candidate.member_id
    }) {
        pairs.push(candidate);
    }
}

fn extract_president_name(value: &str) -> Option<String> {
    let marker = "社長";
    let marker_start = value.rfind(marker)?;
    let prefix = value.get(..marker_start)?;
    let name_reversed: String = prefix
        .chars()
        .rev()
        .take_while(|character| is_japanese_name_character(*character) || character.is_whitespace())
        .collect();
    let name: String = name_reversed.chars().rev().collect();
    let cleaned = name
        .split_whitespace()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" ");
    if remove_long_vowels(&normalize_name(&cleaned)).is_empty() {
        None
    } else {
        Some(format!("{}社長", cleaned.replace('_', "ー")))
    }
}

fn is_japanese_name_character(character: char) -> bool {
    ('ぁ'..='ん').contains(&character)
        || ('ァ'..='ン').contains(&character)
        || ('一'..='龥').contains(&character)
        || character == 'ー'
        || character == '_'
}

fn strip_president(value: &str) -> &str {
    value.strip_suffix("社長").unwrap_or(value)
}

fn remove_long_vowels(value: &str) -> String {
    value.replace('ー', "")
}

fn identifiable_name(normalized: &str) -> bool {
    // A title or OCR punctuation alone cannot identify a player. Apply the same condition to
    // hinted aliases, their display names, and fuzzy matching so generated member IDs remain valid.
    normalized.chars().count() >= MINIMUM_MATCH_CHARACTERS
        && strip_president(normalized)
            .chars()
            .any(|character| character != 'ー')
}

#[expect(
    clippy::indexing_slicing,
    reason = "the reusable dynamic-programming row is right.len() + 1 and character indices are bounded"
)]
fn lcs_ratio(left: &str, right: &str) -> f64 {
    let left_length = left.chars().count();
    let right_length = right.chars().count();
    if left_length < MINIMUM_MATCH_CHARACTERS || right_length < MINIMUM_MATCH_CHARACTERS {
        return 0.0;
    }
    let (left, right) = if left_length < right_length {
        (right, left)
    } else {
        (left, right)
    };
    let right: Vec<char> = right.chars().collect();
    let mut row = vec![0_usize; right.len() + 1];
    for left_character in left.chars() {
        let mut diagonal = 0;
        for (right_index, right_character) in right.iter().enumerate() {
            let next = right_index + 1;
            let previous = row[next];
            row[next] = if left_character == *right_character {
                diagonal + 1
            } else {
                row[right_index].max(previous)
            };
            diagonal = previous;
        }
    }
    let lcs = u32::try_from(row.last().copied().unwrap_or(0)).unwrap_or(u32::MAX);
    let denominator = u32::try_from(left_length.saturating_add(right_length)).unwrap_or(u32::MAX);
    (2.0 * f64::from(lcs)) / f64::from(denominator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_name_extraction_does_not_absorb_latin_ui_noise() {
        let resolver = AliasResolver::from_hints(&OcrHints::default());
        let identity = resolver.extract("KM ばんた社長 3億8340万円");
        assert_eq!(identity.display_name.as_deref(), Some("ぽんた社長"));
    }

    #[test]
    fn bounded_name_confusions_recover_known_player_order_surfaces() {
        assert!(names_match("いーばゆー社長", "いーゆー社長"));
        assert!(names_match("いーゆー社長", "い一了ゆ一社長"));
        let resolver = AliasResolver::from_hints(&OcrHints::default());
        let identity = resolver.extract("GBs N01 1社長 1億8620万円");
        assert_eq!(identity.display_name.as_deref(), Some("NO11社長"));
    }

    #[test]
    fn punctuation_and_titles_cannot_match_an_unrelated_player() {
        let resolver = AliasResolver::from_hints(&OcrHints::default());
        for noise in [
            "ーーー",
            "ーーー社長",
            "___社長",
            "---社長",
            "一一一社長",
            "社長",
        ] {
            assert!(!names_match(noise, "ぽんた社長"), "noise: {noise}");
            assert!(!names_match("ぽんた社長", noise), "noise: {noise}");
            assert_eq!(
                resolver.extract(noise).display_name,
                None,
                "unreadable OCR must retain the missing-name warning: {noise}"
            );
        }
    }

    #[test]
    fn sequence_similarity_preserves_order_repetitions_and_unicode() {
        for (left, right, expected) in [
            ("abcdef", "ace", 2.0 / 3.0),
            ("aaaa", "aaa", 6.0 / 7.0),
            ("abc", "cba", 1.0 / 3.0),
            ("あいうえお", "あえお", 0.75),
            ("abc", "def", 0.0),
        ] {
            assert!((lcs_ratio(left, right) - expected).abs() < f64::EPSILON);
            assert!((lcs_ratio(right, left) - expected).abs() < f64::EPSILON);
        }
    }
}
