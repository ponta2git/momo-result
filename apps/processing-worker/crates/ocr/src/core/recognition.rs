use std::path::PathBuf;

use image::{DynamicImage, GrayImage};
use tesseract::{OcrEngineMode, PageSegMode, Tesseract};
use thiserror::Error;

#[derive(Clone, Debug)]
pub(crate) struct RecognizedText {
    pub(crate) text: String,
    pub(crate) confidence: Option<f64>,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(crate) enum RecognitionError {
    #[error("Tesseract OCR engine could not initialize")]
    EngineUnavailable,
    #[error("Tesseract OCR call failed")]
    RecognitionFailed,
    #[error("Tesseract OCR dimensions exceeded the checked native boundary")]
    Dimensions,
}

#[derive(Clone, Copy)]
pub(crate) enum RecognitionLanguage {
    General,
    IncidentDigits,
}

pub(crate) struct RecognitionSession {
    tessdata_path: Option<PathBuf>,
    general: Option<Tesseract>,
    incident_digits: Option<Tesseract>,
}

impl RecognitionSession {
    pub(crate) fn new(tessdata_path: Option<PathBuf>) -> Result<Self, RecognitionError> {
        let general = Some(initialize(
            tessdata_path.as_deref(),
            "jpn+eng",
            RecognitionLanguage::General,
        )?);
        Ok(Self {
            tessdata_path,
            general,
            incident_digits: None,
        })
    }

    pub(crate) fn recognize(
        &mut self,
        image: &GrayImage,
        language: RecognitionLanguage,
        psm: u8,
    ) -> Result<RecognizedText, RecognitionError> {
        self.recognize_frame(
            image.as_raw(),
            image.width(),
            image.height(),
            1,
            image.width(),
            language,
            psm,
        )
    }

    pub(crate) fn recognize_color(
        &mut self,
        image: &DynamicImage,
        language: RecognitionLanguage,
        psm: u8,
    ) -> Result<RecognizedText, RecognitionError> {
        let rgb = image.to_rgb8();
        let bytes_per_line = rgb
            .width()
            .checked_mul(3)
            .ok_or(RecognitionError::Dimensions)?;
        self.recognize_frame(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            3,
            bytes_per_line,
            language,
            psm,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the checked native frame boundary requires explicit dimensions and OCR configuration"
    )]
    fn recognize_frame(
        &mut self,
        bytes: &[u8],
        width: u32,
        height: u32,
        bytes_per_pixel: i32,
        bytes_per_line: u32,
        language: RecognitionLanguage,
        psm: u8,
    ) -> Result<RecognizedText, RecognitionError> {
        let mut api = self.take_or_initialize(language)?;
        api.set_page_seg_mode(page_segmentation_mode(psm)?);
        let width = i32::try_from(width).map_err(|_error| RecognitionError::Dimensions)?;
        let height = i32::try_from(height).map_err(|_error| RecognitionError::Dimensions)?;
        let bytes_per_line =
            i32::try_from(bytes_per_line).map_err(|_error| RecognitionError::Dimensions)?;
        let mut api = api
            .set_frame(bytes, width, height, bytes_per_pixel, bytes_per_line)
            .map_err(|_error| RecognitionError::RecognitionFailed)?
            .recognize()
            .map_err(|_error| RecognitionError::RecognitionFailed)?;
        let text = api
            .get_text()
            .map_err(|_error| RecognitionError::RecognitionFailed)?;
        let confidence_raw = api.mean_text_conf();
        self.put(language, api);
        Ok(RecognizedText {
            text: normalize_text(&text),
            confidence: (confidence_raw >= 0).then(|| f64::from(confidence_raw) / 100.0),
        })
    }

    fn take_or_initialize(
        &mut self,
        language: RecognitionLanguage,
    ) -> Result<Tesseract, RecognitionError> {
        let slot = match language {
            RecognitionLanguage::General => &mut self.general,
            RecognitionLanguage::IncidentDigits => &mut self.incident_digits,
        };
        if let Some(api) = slot.take() {
            return Ok(api);
        }
        let language_name = match language {
            RecognitionLanguage::General => "jpn+eng",
            RecognitionLanguage::IncidentDigits => "eng",
        };
        initialize(self.tessdata_path.as_deref(), language_name, language)
    }

    fn put(&mut self, language: RecognitionLanguage, api: Tesseract) {
        match language {
            RecognitionLanguage::General => self.general = Some(api),
            RecognitionLanguage::IncidentDigits => self.incident_digits = Some(api),
        }
    }
}

fn initialize(
    tessdata_path: Option<&std::path::Path>,
    language_name: &str,
    language: RecognitionLanguage,
) -> Result<Tesseract, RecognitionError> {
    let path = tessdata_path.and_then(std::path::Path::to_str);
    let api = Tesseract::new_with_oem(path, Some(language_name), OcrEngineMode::LstmOnly)
        .map_err(|_error| RecognitionError::EngineUnavailable)?;
    if matches!(language, RecognitionLanguage::IncidentDigits) {
        api.set_variable("tessedit_char_whitelist", "0123456789OoIl|i")
            .map_err(|_error| RecognitionError::EngineUnavailable)
    } else {
        Ok(api)
    }
}

const fn page_segmentation_mode(psm: u8) -> Result<PageSegMode, RecognitionError> {
    match psm {
        3 => Ok(PageSegMode::PsmAuto),
        6 => Ok(PageSegMode::PsmSingleBlock),
        7 => Ok(PageSegMode::PsmSingleLine),
        8 => Ok(PageSegMode::PsmSingleWord),
        10 => Ok(PageSegMode::PsmSingleChar),
        11 => Ok(PageSegMode::PsmSparseText),
        13 => Ok(PageSegMode::PsmRawLine),
        _ => Err(RecognitionError::RecognitionFailed),
    }
}

fn normalize_text(value: &str) -> String {
    value
        .replace('　', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
