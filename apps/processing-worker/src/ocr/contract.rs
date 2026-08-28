use std::{collections::BTreeMap, str};

pub(crate) use momo_ocr::{OcrHints, RequestedScreenType};
pub(crate) use momo_ocr::{OcrMediaType, OcrQueuePayload};
use redis::{Value, streams::StreamId};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const SCHEMA_VERSION: &str = "2";
const MAXIMUM_ID_BYTES: usize = 128;
const MAXIMUM_OBJECT_KEY_BYTES: usize = 512;
const MAXIMUM_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const MAXIMUM_HINT_BYTES: usize = 8192;
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

/// Integrity claims required to fetch one private source image.
///
/// Queue and database adapters validate their own wire/row shapes before producing this value, so
/// the object-store adapter does not depend on either transport representation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SourceImageClaims {
    object_key: String,
    sha256: String,
    byte_length: u64,
    media_type: OcrMediaType,
}

/// One completely validated OCR queue delivery.
///
/// The capability payload contains only execution data. `wire_fields` deliberately retains the
/// complete closed transport projection so a Redis delivery can be compared byte-for-byte with
/// the immutable `PostgreSQL` outbox intent before any job is claimed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ValidatedOcrDelivery {
    payload: OcrQueuePayload,
    wire_fields: BTreeMap<&'static str, String>,
}

impl ValidatedOcrDelivery {
    #[must_use]
    pub(crate) const fn payload(&self) -> &OcrQueuePayload {
        &self.payload
    }
}

impl SourceImageClaims {
    pub(crate) fn new(
        object_key: String,
        sha256: String,
        byte_length: u64,
        media_type: OcrMediaType,
    ) -> Option<Self> {
        if valid_object_key(&object_key)
            && valid_sha256(&sha256)
            && (1..=MAXIMUM_IMAGE_BYTES).contains(&byte_length)
        {
            Some(Self {
                object_key,
                sha256,
                byte_length,
                media_type,
            })
        } else {
            None
        }
    }

    pub(crate) fn try_from_payload(payload: &OcrQueuePayload) -> Option<Self> {
        Self::new(
            String::from(payload.image_object_key()),
            String::from(payload.sha256()),
            payload.byte_length(),
            payload.media_type(),
        )
    }

    pub(crate) fn object_key(&self) -> &str {
        &self.object_key
    }

    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }

    pub(crate) const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    pub(crate) const fn media_type(&self) -> OcrMediaType {
        self.media_type
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(crate) enum OcrQueueContractError {
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
pub(crate) fn parse_delivery(
    delivery: &StreamId,
) -> Result<OcrQueuePayload, OcrQueueContractError> {
    parse_validated_delivery(delivery).map(|delivery| delivery.payload)
}

/// Decodes the exact closed Redis payload while retaining every validated wire field.
///
/// # Errors
///
/// Returns the same field-level contract error as [`parse_delivery`].
pub(crate) fn parse_validated_delivery(
    delivery: &StreamId,
) -> Result<ValidatedOcrDelivery, OcrQueueContractError> {
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
    u32::try_from(attempt_value)
        .ok()
        .filter(|value| i32::try_from(*value).is_ok())
        .ok_or(OcrQueueContractError::InvalidField("attempt"))?;
    let enqueued_at = required_string(delivery, "enqueuedAt")?;
    OffsetDateTime::parse(&enqueued_at, &Rfc3339)
        .map_err(|_parse_error| OcrQueueContractError::InvalidField("enqueuedAt"))?;
    let hints_json = optional_string(delivery, "ocrHintsJson")?;
    let hints = hints_json
        .as_deref()
        .map_or_else(|| Ok(OcrHints::default()), parse_hints)?;
    let request_id = optional_string(delivery, "requestId")?;
    if request_id
        .as_deref()
        .is_some_and(|value| !valid_request_id(value))
    {
        return Err(OcrQueueContractError::InvalidField("requestId"));
    }

    let mut wire_fields = BTreeMap::from([
        ("schemaVersion", schema_version),
        ("jobId", job_id.clone()),
        ("draftId", draft_id.clone()),
        ("sourceImageId", source_image_id.clone()),
        ("imageObjectKey", image_object_key.clone()),
        ("sha256", sha256.clone()),
        ("byteLength", byte_length_value),
        ("mediaType", String::from(media_type.wire())),
        (
            "requestedScreenType",
            String::from(requested_screen_type.wire()),
        ),
        ("attempt", attempt_string),
        ("enqueuedAt", enqueued_at),
    ]);
    if let Some(hints_json) = hints_json {
        wire_fields.insert("ocrHintsJson", hints_json);
    }
    if let Some(request_id) = request_id {
        wire_fields.insert("requestId", request_id);
    }

    Ok(ValidatedOcrDelivery {
        payload: OcrQueuePayload::new(
            job_id,
            draft_id,
            source_image_id,
            image_object_key,
            sha256,
            byte_length,
            media_type,
            requested_screen_type,
            hints,
        ),
        wire_fields,
    })
}

/// Decodes the immutable `PostgreSQL` outbox payload through the same closed transport contract.
///
/// # Errors
///
/// Returns the same bounded field error as Redis decoding when the durable enqueue intent has
/// drifted or been corrupted.
pub(crate) fn parse_persisted_payload(
    payload: &serde_json::Value,
) -> Result<ValidatedOcrDelivery, OcrQueueContractError> {
    let object = payload
        .as_object()
        .ok_or(OcrQueueContractError::ClosedFieldSet)?;
    let delivery = StreamId {
        id: String::new(),
        map: object
            .iter()
            .map(|(field, value)| {
                let value = value.as_str().map_or(Value::Nil, |value| {
                    Value::BulkString(value.as_bytes().to_vec())
                });
                (field.clone(), value)
            })
            .collect(),
    };
    parse_validated_delivery(&delivery)
}

/// Extracts only a bounded job ID for terminal malformed-delivery handling.
#[must_use]
#[cfg_attr(
    all(not(target_os = "linux"), not(test)),
    expect(
        dead_code,
        reason = "malformed delivery handling is performed by the production Linux consumer"
    )
)]
pub(crate) fn recoverable_job_id(delivery: &StreamId) -> Option<String> {
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
    if hints.is_valid() {
        Ok(hints)
    } else {
        Err(OcrQueueContractError::InvalidHints)
    }
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
        assert_eq!(payload.hints(), &OcrHints::default());

        let persisted = serde_json::from_str::<serde_json::Value>(VALID_PAYLOAD);
        let Ok(persisted) = persisted else {
            panic!("shared OCR v2 fixture is not JSON");
        };
        assert_eq!(
            parse_persisted_payload(&persisted),
            parse_validated_delivery(&delivery)
        );
    }

    #[test]
    fn persisted_outbox_payload_rejects_non_string_and_open_fields() {
        let Ok(mut non_string) = serde_json::from_str::<serde_json::Value>(VALID_PAYLOAD) else {
            panic!("shared OCR v2 fixture is not JSON");
        };
        let Some(non_string_fields) = non_string.as_object_mut() else {
            panic!("shared OCR v2 fixture is not an object");
        };
        assert!(
            non_string_fields
                .insert(String::from("attempt"), serde_json::json!(1))
                .is_some(),
            "shared fixture must contain attempt"
        );
        assert_eq!(
            parse_persisted_payload(&non_string),
            Err(OcrQueueContractError::NonStringField("attempt"))
        );

        let Ok(mut open) = serde_json::from_str::<serde_json::Value>(VALID_PAYLOAD) else {
            panic!("shared OCR v2 fixture is not JSON");
        };
        let Some(open_fields) = open.as_object_mut() else {
            panic!("shared OCR v2 fixture is not an object");
        };
        assert!(
            open_fields
                .insert(String::from("bucket"), serde_json::json!("private"))
                .is_none(),
            "shared fixture must not already contain bucket"
        );
        assert_eq!(
            parse_persisted_payload(&open),
            Err(OcrQueueContractError::ClosedFieldSet)
        );
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
            ("imageObjectKey", "source-images//image.webp"),
            ("imageObjectKey", "source-images/image.webp/"),
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
        assert!(parsed.hints().is_valid());
        let encoded_hints = serde_json::to_value(parsed.hints());
        assert!(
            encoded_hints.is_ok(),
            "validated hints must remain encodable"
        );
        let Ok(encoded_hints) = encoded_hints else {
            return;
        };
        assert_eq!(
            encoded_hints
                .pointer("/gameTitle")
                .and_then(serde_json::Value::as_str),
            Some("桃鉄2")
        );
        assert_eq!(
            encoded_hints
                .pointer("/knownPlayerAliases/0/memberId")
                .and_then(serde_json::Value::as_str),
            Some("member-1")
        );

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
        assert_eq!(
            recoverable_job_id(&delivery),
            Some(String::from("job-v2-1"))
        );

        delivery.map.insert(
            String::from("jobId"),
            Value::BulkString("日本語".as_bytes().to_vec()),
        );
        assert_eq!(recoverable_job_id(&delivery), None);
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
