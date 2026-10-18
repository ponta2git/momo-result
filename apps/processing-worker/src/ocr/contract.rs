use std::collections::BTreeMap;

pub(crate) use momo_ocr::{OcrHints, RequestedScreenType};
pub(crate) use momo_ocr::{OcrJobInput, OcrMediaType};
use thiserror::Error;

const SCHEMA_VERSION: &str = "2";
const MAXIMUM_ID_BYTES: usize = 128;
const MAXIMUM_OBJECT_KEY_BYTES: usize = 512;
const MAXIMUM_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const MAXIMUM_HINT_BYTES: usize = 8192;
const REQUIRED_FIELDS: [&str; 9] = [
    "schemaVersion",
    "jobId",
    "draftId",
    "sourceImageId",
    "imageObjectKey",
    "sha256",
    "byteLength",
    "mediaType",
    "requestedScreenType",
];
const OPTIONAL_FIELDS: [&str; 2] = ["ocrHintsJson", "requestId"];

/// Integrity claims required to fetch one private source image.
///
/// Database adapters validate their own wire/row shapes before producing this value, so
/// the object-store adapter does not depend on either transport representation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SourceImageClaims {
    object_key: String,
    sha256: String,
    byte_length: u64,
    media_type: OcrMediaType,
}

/// One validated immutable OCR input snapshot, including its closed metadata fields.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ValidatedOcrInput {
    payload: OcrJobInput,
}

impl ValidatedOcrInput {
    #[must_use]
    pub(crate) const fn payload(&self) -> &OcrJobInput {
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

    pub(crate) fn try_from_payload(payload: &OcrJobInput) -> Option<Self> {
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
pub(crate) enum OcrInputError {
    #[error("OCR input violates the closed field set")]
    ClosedFieldSet,
    #[error("OCR input is missing field {0}")]
    MissingField(&'static str),
    #[error("OCR input field {0} is not a UTF-8 string")]
    NonStringField(&'static str),
    #[error("OCR input field {0} is invalid")]
    InvalidField(&'static str),
    #[error("OCR input hints are invalid")]
    InvalidHints,
}

/// Borrows adapter-owned strings until the entire closed wire contract has passed validation.
/// Malformed persisted fields are rejected before execution inputs are allocated.
fn parse_wire_fields<'a>(
    fields: impl ExactSizeIterator<Item = (&'a str, Option<&'a str>)>,
) -> Result<ValidatedOcrInput, OcrInputError> {
    if fields.len() < REQUIRED_FIELDS.len()
        || fields.len() > REQUIRED_FIELDS.len() + OPTIONAL_FIELDS.len()
    {
        return Err(OcrInputError::ClosedFieldSet);
    }
    let fields: BTreeMap<_, _> = fields.collect();
    if fields
        .keys()
        .any(|field| !REQUIRED_FIELDS.contains(field) && !OPTIONAL_FIELDS.contains(field))
    {
        return Err(OcrInputError::ClosedFieldSet);
    }

    let schema_version = required_string(&fields, "schemaVersion")?;
    if schema_version != SCHEMA_VERSION {
        return Err(OcrInputError::InvalidField("schemaVersion"));
    }
    let job_id = validated_id(required_string(&fields, "jobId")?, "jobId")?;
    let draft_id = validated_id(required_string(&fields, "draftId")?, "draftId")?;
    let source_image_id =
        validated_id(required_string(&fields, "sourceImageId")?, "sourceImageId")?;
    let image_object_key = required_string(&fields, "imageObjectKey")?;
    if !valid_object_key(image_object_key) {
        return Err(OcrInputError::InvalidField("imageObjectKey"));
    }
    let sha256 = required_string(&fields, "sha256")?;
    if !valid_sha256(sha256) {
        return Err(OcrInputError::InvalidField("sha256"));
    }
    let byte_length_value = required_string(&fields, "byteLength")?;
    let byte_length = positive_decimal(byte_length_value, "byteLength")?;
    if byte_length > MAXIMUM_IMAGE_BYTES {
        return Err(OcrInputError::InvalidField("byteLength"));
    }
    let media_type = OcrMediaType::parse_wire(required_string(&fields, "mediaType")?)
        .ok_or(OcrInputError::InvalidField("mediaType"))?;
    let requested_screen_type =
        RequestedScreenType::parse_wire(required_string(&fields, "requestedScreenType")?)
            .ok_or(OcrInputError::InvalidField("requestedScreenType"))?;
    let hints_json = optional_string(&fields, "ocrHintsJson")?;
    let hints = hints_json.map_or_else(|| Ok(OcrHints::default()), parse_hints)?;
    let request_id = optional_string(&fields, "requestId")?;
    if request_id.is_some_and(|value| !valid_request_id(value)) {
        return Err(OcrInputError::InvalidField("requestId"));
    }

    Ok(ValidatedOcrInput {
        payload: OcrJobInput::new(
            job_id.to_owned(),
            draft_id.to_owned(),
            source_image_id.to_owned(),
            image_object_key.to_owned(),
            sha256.to_owned(),
            byte_length,
            media_type,
            requested_screen_type,
            hints,
        ),
    })
}

/// Decodes an immutable job input snapshot.
///
/// # Errors
///
/// Rejects malformed, oversized, or unsupported persisted input before any execution.
pub(crate) fn parse_persisted_payload(
    payload: &serde_json::Value,
) -> Result<ValidatedOcrInput, OcrInputError> {
    let object = payload.as_object().ok_or(OcrInputError::ClosedFieldSet)?;
    parse_wire_fields(
        object
            .iter()
            .map(|(field, value)| (field.as_str(), value.as_str())),
    )
}

fn required_string<'a>(
    fields: &BTreeMap<&str, Option<&'a str>>,
    field: &'static str,
) -> Result<&'a str, OcrInputError> {
    fields
        .get(field)
        .ok_or(OcrInputError::MissingField(field))?
        .ok_or(OcrInputError::NonStringField(field))
}

fn optional_string<'a>(
    fields: &BTreeMap<&str, Option<&'a str>>,
    field: &'static str,
) -> Result<Option<&'a str>, OcrInputError> {
    fields
        .get(field)
        .map(|value| value.ok_or(OcrInputError::NonStringField(field)))
        .transpose()
}

fn validated_id<'a>(value: &'a str, field: &'static str) -> Result<&'a str, OcrInputError> {
    if valid_id(value) {
        Ok(value)
    } else {
        Err(OcrInputError::InvalidField(field))
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

fn positive_decimal(value: &str, field: &'static str) -> Result<u64, OcrInputError> {
    if value.is_empty()
        || value.bytes().next() == Some(b'0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(OcrInputError::InvalidField(field));
    }
    value
        .parse::<u64>()
        .map_err(|_parse_error| OcrInputError::InvalidField(field))
}

fn valid_request_id(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn parse_hints(value: &str) -> Result<OcrHints, OcrInputError> {
    if value.len() > MAXIMUM_HINT_BYTES {
        return Err(OcrInputError::InvalidHints);
    }
    let json: serde_json::Value =
        serde_json::from_str(value).map_err(|_parse_error| OcrInputError::InvalidHints)?;
    let object = json.as_object().ok_or(OcrInputError::InvalidHints)?;
    if object.values().any(serde_json::Value::is_null) {
        return Err(OcrInputError::InvalidHints);
    }
    let hints: OcrHints =
        serde_json::from_value(json).map_err(|_parse_error| OcrInputError::InvalidHints)?;
    if hints.is_valid() {
        Ok(hints)
    } else {
        Err(OcrInputError::InvalidHints)
    }
}

#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    reason = "fixture setup errors use Result while assertions describe the input boundary"
)]
mod tests {
    use super::*;

    const VALID_PAYLOAD: &str =
        include_str!("../../../../docs/schemas/fixtures/ocr-worker/valid-job-input-v2.json");

    fn fixture() -> Result<serde_json::Value, serde_json::Error> {
        serde_json::from_str(VALID_PAYLOAD)
    }

    #[test]
    fn retained_legacy_layouts_decode_without_rewriting_immutable_hints()
    -> Result<(), Box<dyn std::error::Error>> {
        let layouts: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../docs/schemas/fixtures/ocr-worker/layout-families-v1.json"
        ))?;
        for entry in layouts
            .get("accepted")
            .and_then(serde_json::Value::as_array)
            .ok_or("accepted cases")?
        {
            let layout = entry
                .get("input")
                .and_then(serde_json::Value::as_str)
                .ok_or("input layout")?;
            let mut input = fixture()?;
            let original_hints = serde_json::json!({"layoutFamily": layout}).to_string();
            input
                .as_object_mut()
                .ok_or("input object")?
                .insert("ocrHintsJson".to_owned(), serde_json::json!(original_hints));
            let before = input.clone();
            let parsed = parse_persisted_payload(&input)?;
            let hints = serde_json::to_value(parsed.payload().hints())?;
            assert_eq!(
                hints
                    .get("layoutFamily")
                    .and_then(serde_json::Value::as_str),
                Some(layout)
            );
            assert_eq!(input, before, "retained input snapshots are immutable");
        }
        for entry in layouts
            .get("rejected")
            .and_then(serde_json::Value::as_array)
            .ok_or("rejected cases")?
        {
            let mut input = fixture()?;
            input.as_object_mut().ok_or("input object")?.insert(
                "ocrHintsJson".to_owned(),
                serde_json::json!(serde_json::json!({"layoutFamily": entry}).to_string()),
            );
            assert_eq!(
                parse_persisted_payload(&input),
                Err(OcrInputError::InvalidHints)
            );
        }
        Ok(())
    }

    #[test]
    fn persisted_input_preserves_enriched_hints_and_image_identity()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut input = fixture()?;
        input.as_object_mut().ok_or("fixture must be an object")?.insert("ocrHintsJson".to_owned(),serde_json::json!(
            r#"{"gameTitle":"桃鉄2","knownPlayerAliases":[{"memberId":"member-1","aliases":["ぽんた"]}]}"#
        ));
        let parsed = parse_persisted_payload(&input)?;
        let payload = parsed.payload();
        assert_eq!(payload.job_id(), "job-v2-1");
        assert_eq!(payload.source_image_id(), "image-v2-1");
        assert_eq!(payload.sha256(), "ab".repeat(32));
        assert_eq!(payload.byte_length(), MAXIMUM_IMAGE_BYTES);
        assert_eq!(
            payload.requested_screen_type(),
            RequestedScreenType::IncidentLog
        );
        let hints = serde_json::to_value(payload.hints())?;
        assert_eq!(
            hints
                .pointer("/knownPlayerAliases/0/memberId")
                .and_then(serde_json::Value::as_str),
            Some("member-1")
        );
        Ok(())
    }

    #[test]
    fn input_rejects_open_fields_coercions_and_invalid_bounds()
    -> Result<(), Box<dyn std::error::Error>> {
        for (field, invalid) in [
            ("bucket", serde_json::json!("private")),
            ("byteLength", serde_json::json!(1)),
            ("schemaVersion", serde_json::json!("unsupported")),
            (
                "imageObjectKey",
                serde_json::json!("source-images/../image.webp"),
            ),
            ("sha256", serde_json::json!("AB")),
            ("byteLength", serde_json::json!("3145729")),
            ("requestedScreenType", serde_json::json!("auto")),
            ("attempt", serde_json::json!("1")),
            ("requestId", serde_json::json!("bad value")),
            ("ocrHintsJson", serde_json::json!(r#"{"gameTitle":null}"#)),
            ("ocrHintsJson", serde_json::json!(r#"{"unknown":"value"}"#)),
        ] {
            let mut input = fixture()?;
            input
                .as_object_mut()
                .ok_or("fixture must be an object")?
                .insert(field.to_owned(), invalid);
            assert!(
                parse_persisted_payload(&input).is_err(),
                "accepted invalid {field}"
            );
        }
        Ok(())
    }
}
