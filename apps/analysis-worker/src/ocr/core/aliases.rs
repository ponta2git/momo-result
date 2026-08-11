use unicode_normalization::UnicodeNormalization;

use crate::ocr::contract::OcrHints;

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
    ("いーゆー社長", &["いーゆー社長", "ローゆー社長"]),
    ("ぽんた社長", &["ぽんた社長", "ほんた社長", "ぼんた社長"]),
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
                .find(|alias| !alias.is_empty())
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
                    surface: alias.clone(),
                    member_id: None,
                },
            );
        }
        Self { pairs }
    }

    pub(crate) fn extract(&self, text: &str) -> PlayerIdentity {
        let normalized = normalize_name(text);
        if let Some(pair) = self.pairs.iter().find(|pair| {
            let surface = normalize_name(&pair.surface);
            surface.chars().count() >= MINIMUM_SAFE_ALIAS_CHARACTERS
                && normalized.contains(&surface)
        }) {
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
    if normalized_left.chars().count() < MINIMUM_MATCH_CHARACTERS
        || normalized_right.chars().count() < MINIMUM_MATCH_CHARACTERS
    {
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
        .replace("いローゆ", "いーゆ")
        .replace("いハーゆ", "いーゆ")
        .replace("ローゆ", "いーゆ")
        .replace("ハーゆ", "いーゆ")
        .replace("バーゆ", "いーゆ")
        .replace("コーツ力", "オータカ");
    corrected
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || ('ぁ'..='ん').contains(character)
                || ('ァ'..='ン').contains(character)
                || ('一'..='龥').contains(character)
                || *character == 'ー'
        })
        .flat_map(char::to_lowercase)
        .collect()
}

fn append_pair(pairs: &mut Vec<AliasPair>, candidate: AliasPair) {
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
        .take_while(|character| is_name_character(*character) || character.is_whitespace())
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
    if cleaned.is_empty() {
        None
    } else {
        Some(format!("{}社長", cleaned.replace('_', "ー")))
    }
}

fn is_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || ('ぁ'..='ん').contains(&character)
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

#[expect(
    clippy::indexing_slicing,
    reason = "dynamic-programming rows are right.len() + 1 and enumerate-derived indices are bounded"
)]
fn lcs_ratio(left: &str, right: &str) -> f64 {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    if left.len() < MINIMUM_MATCH_CHARACTERS || right.len() < MINIMUM_MATCH_CHARACTERS {
        return 0.0;
    }
    let mut previous = vec![0_u16; right.len().saturating_add(1)];
    for left_character in &left {
        let mut current = vec![0_u16; right.len().saturating_add(1)];
        for (right_index, right_character) in right.iter().enumerate() {
            let next = right_index.saturating_add(1);
            current[next] = if left_character == right_character {
                previous[right_index].saturating_add(1)
            } else {
                current[right_index].max(previous[next])
            };
        }
        previous = current;
    }
    let lcs = previous.last().copied().unwrap_or(0);
    let denominator = u32::try_from(left.len().saturating_add(right.len())).unwrap_or(u32::MAX);
    (2.0 * f64::from(lcs)) / f64::from(denominator)
}
