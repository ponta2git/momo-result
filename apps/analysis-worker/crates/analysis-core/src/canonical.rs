use std::{fmt, io, str};

use serde::{Deserialize, Deserializer, Serialize, de};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CanonicalError {
    #[error("JSON is not valid UTF-8: {0}")]
    InvalidUtf8(#[from] str::Utf8Error),
    #[error("invalid JSON: {0}")]
    InvalidJson(serde_json::Error),
    #[error("duplicate JSON object key: {0}")]
    DuplicateKey(String),
    #[error("negative zero is not allowed")]
    NegativeZero,
    #[error("non-finite JSON number is not allowed")]
    NonFiniteNumber,
    #[error("JSON bytes are not in canonical form")]
    NonCanonical,
    #[error("failed to serialize canonical JSON: {0}")]
    Serialize(serde_json::Error),
    #[error("canonical record exceeds the u64 framing limit")]
    RecordTooLarge(#[from] std::num::TryFromIntError),
}

/// Parses JSON while rejecting duplicate keys, negative zero, and non-finite numbers.
///
/// # Errors
///
/// Returns [`CanonicalError`] when the input is not valid canonicalization-domain JSON.
fn parse_strict_json(input: &str) -> Result<Value, CanonicalError> {
    let mut deserializer = serde_json::Deserializer::from_str(input);
    let value = StrictValue::deserialize(&mut deserializer)
        .map_err(|error| classify_deserialize_error(input, error))?
        .0;
    deserializer.end().map_err(CanonicalError::InvalidJson)?;
    Ok(value)
}

/// Encodes strict JSON as RFC 8785 UTF-8 bytes.
///
/// # Errors
///
/// Returns [`CanonicalError`] when strict parsing or canonical serialization fails.
#[cfg(test)]
fn canonicalize_json(input: &str) -> Result<Vec<u8>, CanonicalError> {
    let value = parse_strict_json(input)?;
    serde_json_canonicalizer::to_vec(&value).map_err(CanonicalError::Serialize)
}

/// Encodes an already parsed JSON value as RFC 8785 UTF-8 bytes.
///
/// # Errors
///
/// Returns [`CanonicalError`] when canonical serialization fails.
pub fn canonicalize_value(value: &Value) -> Result<Vec<u8>, CanonicalError> {
    serde_json_canonicalizer::to_vec(value).map_err(CanonicalError::Serialize)
}

/// Streams a value as RFC 8785 UTF-8 bytes without requiring an intermediate byte vector.
///
/// # Errors
///
/// Returns [`CanonicalError::Serialize`] when the value or destination rejects serialization.
pub fn write_canonical<T: Serialize, W: io::Write>(
    value: &T,
    writer: &mut W,
) -> Result<(), CanonicalError> {
    serde_json_canonicalizer::to_writer(value, writer).map_err(CanonicalError::Serialize)
}

/// Parses JSON only when its UTF-8 bytes already use the canonical wire representation.
///
/// # Errors
///
/// Returns [`CanonicalError`] for invalid UTF-8, duplicate keys, unsupported numbers, malformed
/// JSON, or any byte representation that differs from RFC 8785 canonical output.
pub fn parse_canonical_json(input: &[u8]) -> Result<Value, CanonicalError> {
    let text = str::from_utf8(input)?;
    let value = parse_strict_json(text)?;
    let mut comparison = CanonicalComparison::new(input);
    write_canonical(&value, &mut comparison)?;
    if !comparison.matches_exactly() {
        return Err(CanonicalError::NonCanonical);
    }
    Ok(value)
}

struct CanonicalComparison<'a> {
    expected: &'a [u8],
    offset: usize,
    matches: bool,
}

impl<'a> CanonicalComparison<'a> {
    const fn new(expected: &'a [u8]) -> Self {
        Self {
            expected,
            offset: 0,
            matches: true,
        }
    }

    const fn matches_exactly(&self) -> bool {
        self.matches && self.offset == self.expected.len()
    }
}

impl io::Write for CanonicalComparison<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(end) = self.offset.checked_add(buffer.len()) else {
            self.matches = false;
            return Ok(buffer.len());
        };
        if self.expected.get(self.offset..end) != Some(buffer) {
            self.matches = false;
        }
        self.offset = end;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[must_use]
pub fn sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{}", lower_hex(&Sha256::digest(bytes)))
}

/// Encodes bytes as lowercase hexadecimal without allocating intermediate strings.
#[must_use]
pub fn lower_hex(bytes: &[u8]) -> String {
    lower_hex_prefix(bytes, bytes.len())
}

/// Encodes at most `maximum_bytes` as lowercase hexadecimal.
#[must_use]
pub fn lower_hex_prefix(bytes: &[u8], maximum_bytes: usize) -> String {
    let encoded_bytes = bytes.len().min(maximum_bytes);
    let mut output = String::with_capacity(encoded_bytes.saturating_mul(2));
    for byte in bytes.iter().take(encoded_bytes) {
        output.push(char::from(hex_digit(byte >> 4)));
        output.push(char::from(hex_digit(byte & 0x0f)));
    }
    output
}

const fn hex_digit(nibble: u8) -> u8 {
    match nibble {
        0..=9 => b'0' + nibble,
        10..=15 => b'a' + (nibble - 10),
        _ => b'?',
    }
}

/// Incremental framed SHA-256 state.
///
/// Keeping only one canonical record alive at a time is important for source snapshots and
/// manifests whose record count grows with the number of matches.
pub struct FramedSha256(Sha256);

impl FramedSha256 {
    #[must_use]
    pub fn new() -> Self {
        Self(Sha256::new())
    }

    /// Adds one record using an unsigned 64-bit big-endian byte-length prefix.
    ///
    /// # Errors
    ///
    /// Returns [`CanonicalError::RecordTooLarge`] if the record length cannot fit in a `u64`.
    fn update(&mut self, record: &[u8]) -> Result<(), CanonicalError> {
        let length = u64::try_from(record.len())?;
        self.0.update(length.to_be_bytes());
        self.0.update(record);
        Ok(())
    }

    /// Canonically serializes one record into a reusable buffer and adds its framed bytes.
    ///
    /// # Errors
    ///
    /// Returns an error when canonical serialization or length framing fails.
    pub fn update_serialized<T: Serialize>(
        &mut self,
        record: &T,
        buffer: &mut Vec<u8>,
    ) -> Result<(), CanonicalError> {
        buffer.clear();
        write_canonical(record, buffer)?;
        self.update(buffer)
    }

    #[must_use]
    pub fn finalize(self) -> String {
        format!("sha256:{}", lower_hex(&self.0.finalize()))
    }
}

impl Default for FramedSha256 {
    fn default() -> Self {
        Self::new()
    }
}

struct StrictValue(Value);

impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictValueVisitor)
    }
}

struct StrictValueVisitor;

impl<'de> de::Visitor<'de> for StrictValueVisitor {
    type Value = StrictValue;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("strict JSON without duplicate keys or invalid numbers")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Bool(value)))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Number(Number::from(value))))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Number(Number::from(value))))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if !value.is_finite() {
            return Err(E::custom("non_finite_number"));
        }
        if value == 0.0 && value.is_sign_negative() {
            return Err(E::custom("negative_zero"));
        }
        Number::from_f64(value)
            .map(|number| StrictValue(Value::Number(number)))
            .ok_or_else(|| E::custom("non_finite_number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string(String::from(value))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::String(value)))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Null))
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Null))
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: de::SeqAccess<'de>,
    {
        let mut values = Vec::with_capacity(sequence.size_hint().unwrap_or(0));
        while let Some(value) = sequence.next_element::<StrictValue>()? {
            values.push(value.0);
        }
        Ok(StrictValue(Value::Array(values)))
    }

    fn visit_map<A>(self, mut object: A) -> Result<Self::Value, A::Error>
    where
        A: de::MapAccess<'de>,
    {
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom(format!("duplicate_key:{key}")));
            }
            let value = object.next_value::<StrictValue>()?;
            values.insert(key, value.0);
        }
        Ok(StrictValue(Value::Object(values)))
    }
}

fn classify_deserialize_error(input: &str, error: serde_json::Error) -> CanonicalError {
    let message = error.to_string();
    if let Some(key) = message
        .split("duplicate_key:")
        .nth(1)
        .and_then(|value| value.split(" at line").next())
    {
        return CanonicalError::DuplicateKey(String::from(key));
    }
    if message.contains("negative_zero") || input_contains_negative_zero(input) {
        return CanonicalError::NegativeZero;
    }
    if message.contains("non_finite_number") {
        return CanonicalError::NonFiniteNumber;
    }
    CanonicalError::InvalidJson(error)
}

fn input_contains_negative_zero(input: &str) -> bool {
    input
        .as_bytes()
        .windows(2)
        .enumerate()
        .any(|(index, pair)| {
            pair == b"-0"
                && input
                    .as_bytes()
                    .get(index.wrapping_sub(1))
                    .is_none_or(|byte| !byte.is_ascii_digit() && *byte != b'.')
        })
}

#[cfg(test)]
#[expect(
    clippy::panic,
    reason = "checked-in canonicalization vectors are mandatory test preconditions"
)]
mod tests {
    use super::*;

    const VECTORS: &str = include_str!(
        "../../../../../docs/schemas/fixtures/series-analysis/canonicalization-v1.json"
    );

    fn vectors() -> Value {
        serde_json::from_str(VECTORS)
            .unwrap_or_else(|error| panic!("invalid canonicalization vector file: {error}"))
    }

    fn required_field<'a>(value: &'a Value, name: &str) -> &'a Value {
        value
            .get(name)
            .unwrap_or_else(|| panic!("missing canonicalization vector field: {name}"))
    }

    fn required_str<'a>(value: &'a Value, name: &str) -> &'a str {
        required_field(value, name)
            .as_str()
            .unwrap_or_else(|| panic!("canonicalization vector field must be a string: {name}"))
    }

    #[test]
    fn canonical_json_vectors_match() {
        let vectors = vectors();
        for case in required_field(&vectors, "canonicalJsonCases")
            .as_array()
            .unwrap_or_else(|| panic!("canonicalJsonCases must be an array"))
        {
            let name = required_str(case, "name");
            let input = required_str(case, "input");
            let canonical = canonicalize_json(input)
                .unwrap_or_else(|error| panic!("canonicalization failed for {name}: {error}"));
            assert_eq!(
                str::from_utf8(&canonical).unwrap_or_else(|error| panic!("not UTF-8: {error}")),
                required_str(case, "canonical"),
                "canonical bytes changed for {name}"
            );
            assert_eq!(
                sha256_prefixed(&canonical),
                required_str(case, "checksum"),
                "canonical checksum changed for {name}"
            );
            parse_canonical_json(&canonical).unwrap_or_else(|error| {
                panic!("canonical output was rejected for {name}: {error}")
            });
        }
    }

    #[test]
    fn rejected_json_vectors_are_rejected() {
        let vectors = vectors();
        for case in required_field(&vectors, "rejectedJsonCases")
            .as_array()
            .unwrap_or_else(|| panic!("rejectedJsonCases must be an array"))
        {
            let name = required_str(case, "name");
            let reason = required_str(case, "reason");
            let result = canonicalize_json(required_str(case, "input"));
            let expected_error = match reason {
                "duplicate_key" => matches!(result, Err(CanonicalError::DuplicateKey(_))),
                "negative_zero" => matches!(result, Err(CanonicalError::NegativeZero)),
                unsupported => {
                    assert_eq!(unsupported, "known canonical rejection reason");
                    false
                }
            };
            assert!(
                expected_error,
                "wrong rejection reason for {name}: {reason}"
            );
        }
    }

    #[test]
    fn canonical_wire_parser_rejects_alternate_encodings() {
        assert!(matches!(
            parse_canonical_json(br#"{ "value": 1 }"#),
            Err(CanonicalError::NonCanonical)
        ));
        assert!(matches!(
            parse_canonical_json(&[0xff]),
            Err(CanonicalError::InvalidUtf8(_))
        ));
    }

    #[test]
    fn framed_source_and_root_vectors_match() {
        let vectors = vectors();
        for key in ["sourceChecksumCase", "rootChecksumCase"] {
            let records_field = if key == "sourceChecksumCase" {
                "canonicalRecords"
            } else {
                "canonicalEntries"
            };
            let vector = required_field(&vectors, key);
            let bytes = required_field(vector, records_field)
                .as_array()
                .unwrap_or_else(|| panic!("{key}.{records_field} must be an array"))
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .unwrap_or_else(|| panic!("{key}.{records_field} item must be a string"))
                        .as_bytes()
                })
                .collect::<Vec<_>>();
            let mut digest = FramedSha256::new();
            for record in bytes {
                digest
                    .update(record)
                    .unwrap_or_else(|error| panic!("hash update failed: {error}"));
            }
            assert_eq!(digest.finalize(), required_str(vector, "checksum"));
        }
    }
}
