use std::str;

use redis::{Value, streams::StreamId};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const SCHEMA_VERSION: &str = "2";
const MAXIMUM_ID_BYTES: usize = 128;
const MAXIMUM_OBJECT_KEY_BYTES: usize = 512;
const MAXIMUM_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const MAXIMUM_HINT_BYTES: usize = 8192;
const MAXIMUM_HINT_TEXT_CHARACTERS: usize = 64;
const MAXIMUM_KNOWN_PLAYERS: usize = 4;
const MAXIMUM_MEMBER_ID_CHARACTERS: usize = 128;
const MAXIMUM_ALIASES_PER_PLAYER: usize = 8;
const MAXIMUM_COMPUTER_ALIASES: usize = 8;
const REQUIRED_FIELDS: [&str; 11] = [
    "schemaVersion",
    "jobId",
    "draftId",
    "sourceImageId",
    "imageObjectKey",
    "sha256",
    "byteLength",
    "mediaType",
    "requestedScreenType",
    "attempt",
    "enqueuedAt",
];
const OPTIONAL_FIELDS: [&str; 2] = ["ocrHintsJson", "requestId"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrMediaType {
    Png,
    Jpeg,
    Webp,
}

impl OcrMediaType {
    pub(crate) fn parse_wire(value: &str) -> Option<Self> {
        match value {
            "image/png" => Some(Self::Png),
            "image/jpeg" => Some(Self::Jpeg),
            "image/webp" => Some(Self::Webp),
            _ => None,
        }
    }

    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestedScreenType {
    TotalAssets,
    Revenue,
    IncidentLog,
}

impl RequestedScreenType {
    pub(crate) fn parse_wire(value: &str) -> Option<Self> {
        match value {
            "total_assets" => Some(Self::TotalAssets),
            "revenue" => Some(Self::Revenue),
            "incident_log" => Some(Self::IncidentLog),
            _ => None,
        }
    }

    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::TotalAssets => "total_assets",
            Self::Revenue => "revenue",
            Self::IncidentLog => "incident_log",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayerAliasHint {
    member_id: String,
    aliases: Vec<String>,
}

impl PlayerAliasHint {
    #[must_use]
    pub fn member_id(&self) -> &str {
        &self.member_id
    }

    #[must_use]
    pub fn aliases(&self) -> &[String] {
        &self.aliases
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OcrHints {
    game_title: Option<String>,
    layout_family: Option<String>,
    #[serde(default)]
    known_player_aliases: Vec<PlayerAliasHint>,
    #[serde(default)]
    computer_player_aliases: Vec<String>,
}

impl OcrHints {
    #[must_use]
    pub fn game_title(&self) -> Option<&str> {
        self.game_title.as_deref()
    }

    #[must_use]
    pub fn layout_family(&self) -> Option<&str> {
        self.layout_family.as_deref()
    }

    #[must_use]
    pub fn known_player_aliases(&self) -> &[PlayerAliasHint] {
        &self.known_player_aliases
    }

    #[must_use]
    pub fn computer_player_aliases(&self) -> &[String] {
        &self.computer_player_aliases
    }

    pub(crate) fn validate(&self) -> bool {
        self.game_title.as_deref().is_none_or(valid_hint_text)
            && self.layout_family.as_deref().is_none_or(valid_hint_text)
            && self.known_player_aliases.len() <= MAXIMUM_KNOWN_PLAYERS
            && self.known_player_aliases.iter().all(|hint| {
                valid_bounded_text(&hint.member_id, MAXIMUM_MEMBER_ID_CHARACTERS)
                    && !hint.aliases.is_empty()
                    && hint.aliases.len() <= MAXIMUM_ALIASES_PER_PLAYER
                    && hint.aliases.iter().all(|alias| valid_hint_text(alias))
            })
            && self.computer_player_aliases.len() <= MAXIMUM_COMPUTER_ALIASES
            && self
                .computer_player_aliases
                .iter()
                .all(|alias| valid_hint_text(alias))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OcrQueuePayload {
    job_id: String,
    draft_id: String,
    source_image_id: String,
    image_object_key: String,
    sha256: String,
    byte_length: u64,
    media_type: OcrMediaType,
    requested_screen_type: RequestedScreenType,
    attempt: u32,
    enqueued_at: OffsetDateTime,
    hints: OcrHints,
    request_id: Option<String>,
}

impl OcrQueuePayload {
    #[must_use]
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    #[must_use]
    pub fn draft_id(&self) -> &str {
        &self.draft_id
    }

    #[must_use]
    pub fn source_image_id(&self) -> &str {
        &self.source_image_id
    }

    #[must_use]
    pub fn image_object_key(&self) -> &str {
        &self.image_object_key
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub const fn media_type(&self) -> OcrMediaType {
        self.media_type
    }

    #[must_use]
    pub const fn requested_screen_type(&self) -> RequestedScreenType {
        self.requested_screen_type
    }

    #[must_use]
    pub const fn attempt(&self) -> u32 {
        self.attempt
    }

    #[must_use]
    pub const fn enqueued_at(&self) -> OffsetDateTime {
        self.enqueued_at
    }

    #[must_use]
    pub const fn hints(&self) -> &OcrHints {
        &self.hints
    }

    #[must_use]
    pub fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum OcrQueueContractError {
    #[error("OCR v2 delivery violates the closed field set")]
    ClosedFieldSet,
    #[error("OCR v2 delivery is missing field {0}")]
    MissingField(&'static str),
    #[error("OCR v2 delivery field {0} is not a UTF-8 string")]
    NonStringField(&'static str),
    #[error("OCR v2 delivery field {0} is invalid")]
    InvalidField(&'static str),
    #[error("OCR v2 delivery hints are invalid")]
    InvalidHints,
}

/// Decodes the exact closed Redis Streams v2 payload without coercing field values.
///
/// # Errors
///
/// Returns a safe field-level classification for malformed, oversized, or unsupported payloads.
pub fn parse_delivery(delivery: &StreamId) -> Result<OcrQueuePayload, OcrQueueContractError> {
    if delivery.map.len() < REQUIRED_FIELDS.len()
        || delivery.map.len() > REQUIRED_FIELDS.len() + OPTIONAL_FIELDS.len()
        || delivery.map.keys().any(|field| {
            !REQUIRED_FIELDS.contains(&field.as_str()) && !OPTIONAL_FIELDS.contains(&field.as_str())
        })
    {
        return Err(OcrQueueContractError::ClosedFieldSet);
    }

    let schema_version = required_string(delivery, "schemaVersion")?;
    if schema_version != SCHEMA_VERSION {
        return Err(OcrQueueContractError::InvalidField("schemaVersion"));
    }
    let job_id = validated_id(required_string(delivery, "jobId")?, "jobId")?;
    let draft_id = validated_id(required_string(delivery, "draftId")?, "draftId")?;
    let source_image_id =
        validated_id(required_string(delivery, "sourceImageId")?, "sourceImageId")?;
    let image_object_key = required_string(delivery, "imageObjectKey")?;
    if !valid_object_key(&image_object_key) {
        return Err(OcrQueueContractError::InvalidField("imageObjectKey"));
    }
    let sha256 = required_string(delivery, "sha256")?;
    if !valid_sha256(&sha256) {
        return Err(OcrQueueContractError::InvalidField("sha256"));
    }
    let byte_length_value = required_string(delivery, "byteLength")?;
    let byte_length = positive_decimal(&byte_length_value, "byteLength")?;
    if byte_length > MAXIMUM_IMAGE_BYTES {
        return Err(OcrQueueContractError::InvalidField("byteLength"));
    }
    let media_type = OcrMediaType::parse_wire(&required_string(delivery, "mediaType")?)
        .ok_or(OcrQueueContractError::InvalidField("mediaType"))?;
    let requested_screen_type =
        RequestedScreenType::parse_wire(&required_string(delivery, "requestedScreenType")?)
            .ok_or(OcrQueueContractError::InvalidField("requestedScreenType"))?;
    let attempt_string = required_string(delivery, "attempt")?;
    let attempt_value = positive_decimal(&attempt_string, "attempt")?;
    let attempt = u32::try_from(attempt_value)
        .ok()
        .filter(|value| i32::try_from(*value).is_ok())
        .ok_or(OcrQueueContractError::InvalidField("attempt"))?;
    let enqueued_at = OffsetDateTime::parse(&required_string(delivery, "enqueuedAt")?, &Rfc3339)
        .map_err(|_parse_error| OcrQueueContractError::InvalidField("enqueuedAt"))?;
    let hints = optional_string(delivery, "ocrHintsJson")?
        .map_or_else(|| Ok(OcrHints::default()), |value| parse_hints(&value))?;
    let request_id = optional_string(delivery, "requestId")?;
    if request_id
        .as_deref()
        .is_some_and(|value| !valid_request_id(value))
    {
        return Err(OcrQueueContractError::InvalidField("requestId"));
    }

    Ok(OcrQueuePayload {
        job_id,
        draft_id,
        source_image_id,
        image_object_key,
        sha256,
        byte_length,
        media_type,
        requested_screen_type,
        attempt,
        enqueued_at,
        hints,
        request_id,
    })
}

/// Extracts only a bounded job ID for terminal malformed-delivery handling.
#[must_use]
pub fn readable_job_id(delivery: &StreamId) -> Option<String> {
    required_string(delivery, "jobId")
        .ok()
        .filter(|value| valid_id(value))
}

fn required_string(
    delivery: &StreamId,
    field: &'static str,
) -> Result<String, OcrQueueContractError> {
    let value = delivery
        .map
        .get(field)
        .ok_or(OcrQueueContractError::MissingField(field))?;
    strict_string(value).ok_or(OcrQueueContractError::NonStringField(field))
}

fn optional_string(
    delivery: &StreamId,
    field: &'static str,
) -> Result<Option<String>, OcrQueueContractError> {
    delivery
        .map
        .get(field)
        .map(|value| strict_string(value).ok_or(OcrQueueContractError::NonStringField(field)))
        .transpose()
}

fn strict_string(value: &Value) -> Option<String> {
    match value {
        Value::BulkString(bytes) => str::from_utf8(bytes).ok().map(String::from),
        Value::Nil
        | Value::Int(_)
        | Value::Array(_)
        | Value::SimpleString(_)
        | Value::Okay
        | Value::Map(_)
        | Value::Attribute { .. }
        | Value::Set(_)
        | Value::Double(_)
        | Value::Boolean(_)
        | Value::VerbatimString { .. }
        | Value::BigNumber(_)
        | Value::Push { .. }
        | Value::ServerError(_) => None,
    }
}

fn validated_id(value: String, field: &'static str) -> Result<String, OcrQueueContractError> {
    if valid_id(&value) {
        Ok(value)
    } else {
        Err(OcrQueueContractError::InvalidField(field))
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_ID_BYTES
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn valid_object_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_OBJECT_KEY_BYTES
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'/' | b'-'))
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn positive_decimal(value: &str, field: &'static str) -> Result<u64, OcrQueueContractError> {
    if value.is_empty()
        || value.bytes().next() == Some(b'0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(OcrQueueContractError::InvalidField(field));
    }
    value
        .parse::<u64>()
        .map_err(|_parse_error| OcrQueueContractError::InvalidField(field))
}

fn valid_request_id(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn parse_hints(value: &str) -> Result<OcrHints, OcrQueueContractError> {
    if value.len() > MAXIMUM_HINT_BYTES {
        return Err(OcrQueueContractError::InvalidHints);
    }
    let json: serde_json::Value =
        serde_json::from_str(value).map_err(|_parse_error| OcrQueueContractError::InvalidHints)?;
    let object = json
        .as_object()
        .ok_or(OcrQueueContractError::InvalidHints)?;
    if object.values().any(serde_json::Value::is_null) {
        return Err(OcrQueueContractError::InvalidHints);
    }
    let hints: OcrHints =
        serde_json::from_value(json).map_err(|_parse_error| OcrQueueContractError::InvalidHints)?;
    if hints.validate() {
        Ok(hints)
    } else {
        Err(OcrQueueContractError::InvalidHints)
    }
}

fn valid_hint_text(value: &str) -> bool {
    valid_bounded_text(value, MAXIMUM_HINT_TEXT_CHARACTERS)
}

fn valid_bounded_text(value: &str, maximum_characters: usize) -> bool {
    !value.is_empty() && value.chars().count() <= maximum_characters
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "an unreadable checked-in cross-language fixture must fail with its parse diagnostic"
)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    const VALID_PAYLOAD: &str =
        include_str!("../../../../docs/schemas/fixtures/ocr-worker/valid-queue-payload-v2.json");

    #[test]
    fn shared_fixture_decodes_to_the_exact_typed_contract() {
        let delivery = delivery_from_json(VALID_PAYLOAD);
        let payload = parsed_fixture(&delivery);

        assert_eq!(payload.job_id(), "job-v2-1");
        assert_eq!(payload.draft_id(), "draft-v2-1");
        assert_eq!(payload.source_image_id(), "image-v2-1");
        assert_eq!(
            payload.image_object_key(),
            "source-images/2026/image-v2-1.webp"
        );
        assert_eq!(payload.sha256(), "ab".repeat(32));
        assert_eq!(payload.byte_length(), MAXIMUM_IMAGE_BYTES);
        assert_eq!(payload.media_type(), OcrMediaType::Webp);
        assert_eq!(
            payload.requested_screen_type(),
            RequestedScreenType::IncidentLog
        );
        assert_eq!(payload.attempt(), 1);
        assert_eq!(payload.request_id(), Some("req_v2-1"));
        assert_eq!(payload.hints(), &OcrHints::default());
    }

    #[test]
    fn closed_contract_rejects_unknown_missing_and_non_string_fields() {
        let mut unknown = delivery_from_json(VALID_PAYLOAD);
        unknown.map.insert(
            String::from("bucket"),
            Value::BulkString(b"private-bucket".to_vec()),
        );
        assert_eq!(
            parse_delivery(&unknown),
            Err(OcrQueueContractError::ClosedFieldSet)
        );

        let mut missing = delivery_from_json(VALID_PAYLOAD);
        missing.map.remove("sha256");
        assert_eq!(
            parse_delivery(&missing),
            Err(OcrQueueContractError::MissingField("sha256"))
        );

        let mut non_string = delivery_from_json(VALID_PAYLOAD);
        non_string
            .map
            .insert(String::from("attempt"), Value::Int(1));
        assert_eq!(
            parse_delivery(&non_string),
            Err(OcrQueueContractError::NonStringField("attempt"))
        );
    }

    #[test]
    fn image_and_identifier_bounds_are_enforced_before_side_effects() {
        for (field, invalid) in [
            ("imageObjectKey", "/absolute/image.webp"),
            ("imageObjectKey", "source-images/../image.webp"),
            ("imageObjectKey", "https://example.invalid/image.webp"),
            ("sha256", "AB"),
            ("byteLength", "3145729"),
            ("requestedScreenType", "auto"),
            ("attempt", "0"),
            ("requestId", "bad value"),
        ] {
            let mut delivery = delivery_from_json(VALID_PAYLOAD);
            delivery.map.insert(
                String::from(field),
                Value::BulkString(invalid.as_bytes().to_vec()),
            );
            assert!(
                parse_delivery(&delivery).is_err(),
                "accepted invalid {field}"
            );
        }
    }

    #[test]
    fn hints_are_bounded_closed_and_semantically_valid() {
        let valid_hints = r#"{"gameTitle":"桃鉄2","knownPlayerAliases":[{"memberId":"member-1","aliases":["ぽんた"]}]}"#;
        let mut valid = delivery_from_json(VALID_PAYLOAD);
        valid.map.insert(
            String::from("ocrHintsJson"),
            Value::BulkString(valid_hints.as_bytes().to_vec()),
        );
        let parsed = parsed_fixture(&valid);
        assert_eq!(parsed.hints().game_title(), Some("桃鉄2"));
        assert_eq!(parsed.hints().known_player_aliases().len(), 1);

        for invalid_hints in [
            "null",
            r#"{"gameTitle":null}"#,
            r#"{"unknown":"value"}"#,
            r#"{"knownPlayerAliases":[{"memberId":"member-1","aliases":[]}]}"#,
        ] {
            let mut invalid = delivery_from_json(VALID_PAYLOAD);
            invalid.map.insert(
                String::from("ocrHintsJson"),
                Value::BulkString(invalid_hints.as_bytes().to_vec()),
            );
            assert_eq!(
                parse_delivery(&invalid),
                Err(OcrQueueContractError::InvalidHints)
            );
        }
    }

    #[test]
    fn malformed_delivery_exposes_only_a_valid_bounded_job_id() {
        let mut delivery = delivery_from_json(VALID_PAYLOAD);
        delivery.map.insert(
            String::from("schemaVersion"),
            Value::BulkString(b"unsupported".to_vec()),
        );
        assert_eq!(readable_job_id(&delivery), Some(String::from("job-v2-1")));

        delivery.map.insert(
            String::from("jobId"),
            Value::BulkString("日本語".as_bytes().to_vec()),
        );
        assert_eq!(readable_job_id(&delivery), None);
    }

    fn delivery_from_json(encoded: &str) -> StreamId {
        let fields = match serde_json::from_str::<BTreeMap<String, String>>(encoded) {
            Ok(fields) => fields,
            Err(error) => panic!("shared OCR v2 fixture is invalid: {error}"),
        };
        StreamId {
            id: String::from("1-0"),
            map: fields
                .into_iter()
                .map(|(key, field_value)| (key, Value::BulkString(field_value.into_bytes())))
                .collect(),
        }
    }

    fn parsed_fixture(delivery: &StreamId) -> OcrQueuePayload {
        match parse_delivery(delivery) {
            Ok(payload) => payload,
            Err(error) => panic!("shared OCR v2 fixture violates the Rust contract: {error}"),
        }
    }
}
