#![expect(
    clippy::panic_in_result_fn,
    reason = "fixture decoding uses Result while contract mismatches intentionally assert"
)]

use std::error::Error;

use image::GrayImage;
use serde::Deserialize;

use super::*;
use super::{
    incident::{parse_count, select_count_recognition, vote_count},
    preprocess::otsu_binarize,
};

const CHARACTERIZATION: &str = include_str!(
    "../../../../../../docs/schemas/fixtures/ocr-worker/core-characterization-v1.json"
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: u32,
    geometry_cases: Vec<GeometryCase>,
    otsu_cases: Vec<OtsuCase>,
    money_cases: Vec<MoneyCase>,
    count_cases: Vec<CountCase>,
    vote_cases: Vec<VoteCase>,
    selection_cases: Vec<SelectionCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeometryCase {
    name: String,
    profile_rect: FixtureRect,
    image_size: FixtureSize,
    expected: FixtureRect,
}

#[derive(Deserialize)]
struct FixtureRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
struct FixtureSize {
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
struct OtsuCase {
    name: String,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
    expected: Vec<u8>,
}

#[derive(Deserialize)]
struct MoneyCase {
    input: String,
    expected: Option<i64>,
    revenue: bool,
}

#[derive(Deserialize)]
struct CountCase {
    input: String,
    expected: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoteCase {
    name: String,
    attempts: Vec<Attempt>,
    expected_count: Option<u32>,
    expected_confidence: Option<f64>,
}

#[derive(Clone, Deserialize)]
struct Attempt {
    text: String,
    count: Option<u32>,
    confidence: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionCase {
    name: String,
    maximum_plausible_count: u32,
    primary: Attempt,
    fallbacks: Vec<Attempt>,
    expected_count: Option<u32>,
}

#[test]
fn shared_geometry_and_preprocessing_vectors_match() -> Result<(), Box<dyn Error>> {
    let fixture = fixture()?;
    assert_eq!(fixture.schema_version, 1);
    for case in fixture.geometry_cases {
        let actual = scale_profile_rect(
            Rect {
                x: case.profile_rect.x,
                y: case.profile_rect.y,
                width: case.profile_rect.width,
                height: case.profile_rect.height,
            },
            case.image_size.width,
            case.image_size.height,
        )?;
        assert_eq!(
            actual,
            Rect {
                x: case.expected.x,
                y: case.expected.y,
                width: case.expected.width,
                height: case.expected.height,
            },
            "{}",
            case.name
        );
    }
    for case in fixture.otsu_cases {
        let source = GrayImage::from_raw(case.width, case.height, case.pixels)
            .ok_or("invalid Otsu fixture dimensions")?;
        let actual = otsu_binarize(&source).into_raw();
        assert_eq!(actual, case.expected, "{}", case.name);
    }
    Ok(())
}

#[test]
fn shared_domain_parser_vectors_match() -> Result<(), Box<dyn Error>> {
    let fixture = fixture()?;
    for case in fixture.money_cases {
        let actual = if case.revenue {
            parse_revenue_man_yen(&case.input)
        } else {
            parse_money_man_yen(&case.input)
        };
        assert_eq!(actual, case.expected, "{}", case.input);
    }
    for case in fixture.count_cases {
        assert_eq!(parse_count(&case.input), case.expected, "{}", case.input);
    }
    Ok(())
}

#[test]
fn shared_incident_recognition_vectors_match() -> Result<(), Box<dyn Error>> {
    let fixture = fixture()?;
    for case in fixture.vote_cases {
        let attempts: Vec<PsmAttempt> = case
            .attempts
            .into_iter()
            .map(|attempt| PsmAttempt {
                text: attempt.text,
                count: attempt.count,
                confidence: attempt.confidence,
            })
            .collect();
        assert_eq!(
            vote_count(&attempts),
            (case.expected_count, case.expected_confidence),
            "{}",
            case.name
        );
    }
    for case in fixture.selection_cases {
        let primary = recognition(case.primary);
        let fallbacks: Vec<CountRecognition> =
            case.fallbacks.into_iter().map(recognition).collect();
        let actual = select_count_recognition(&primary, &fallbacks, case.maximum_plausible_count);
        assert_eq!(actual.count, case.expected_count, "{}", case.name);
    }
    Ok(())
}

fn fixture() -> Result<Fixture, serde_json::Error> {
    serde_json::from_str(CHARACTERIZATION)
}

fn recognition(attempt: Attempt) -> CountRecognition {
    CountRecognition {
        raw_text: attempt.text,
        count: attempt.count,
        confidence: attempt.confidence,
    }
}
