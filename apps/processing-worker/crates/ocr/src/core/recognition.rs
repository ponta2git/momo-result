use image::{DynamicImage, GrayImage};
use thiserror::Error;

/// Text returned by a native recognizer after capability-owned normalization.
#[derive(Debug)]
pub struct RecognizedText {
    pub(crate) text: String,
    pub(crate) confidence: Option<f64>,
}

impl RecognizedText {
    /// Normalizes native whitespace without interpreting the OCR contents.
    #[must_use]
    pub fn new(text: &str, confidence: Option<f64>) -> Self {
        Self {
            text: normalize_text(text),
            confidence,
        }
    }
}

/// Closed failure vocabulary exposed by the native recognition port.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum RecognitionError {
    #[error("OCR engine could not initialize")]
    EngineUnavailable,
    #[error("OCR recognition call failed")]
    RecognitionFailed,
    #[error("OCR frame dimensions exceeded the checked native boundary")]
    Dimensions,
}

/// OCR model selected for one recognition request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecognitionLanguage {
    General,
    IncidentDigits,
}

/// Finite segmentation modes used by the versioned OCR algorithm.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PageSegmentationMode {
    SingleBlock,
    SingleLine,
    SingleWord,
    SingleChar,
    SparseText,
    RawLine,
}

/// Checked, tightly packed image frame passed to a native recognition adapter.
///
/// Construction stays inside the capability so an adapter cannot receive inconsistent dimensions
/// or derive them from unchecked integer casts.
#[derive(Clone, Copy, Debug)]
pub struct RecognitionFrame<'a> {
    bytes: &'a [u8],
    width: i32,
    height: i32,
    bytes_per_pixel: i32,
    bytes_per_line: i32,
}

impl RecognitionFrame<'_> {
    #[must_use]
    pub const fn bytes(&self) -> &[u8] {
        self.bytes
    }

    #[must_use]
    pub const fn width(&self) -> i32 {
        self.width
    }

    #[must_use]
    pub const fn height(&self) -> i32 {
        self.height
    }

    #[must_use]
    pub const fn bytes_per_pixel(&self) -> i32 {
        self.bytes_per_pixel
    }

    #[must_use]
    pub const fn bytes_per_line(&self) -> i32 {
        self.bytes_per_line
    }
}

/// Native OCR boundary required by the deterministic image/parser capability.
///
/// Implementations own native library initialization and mutable engine reuse. The capability owns
/// preprocessing, checked frame construction, typed language/mode selection, and interpretation.
pub trait RecognitionPort {
    /// Initializes the general OCR model after image decoding has succeeded.
    ///
    /// # Errors
    ///
    /// Returns [`RecognitionError::EngineUnavailable`] when the native engine cannot start.
    fn initialize(&mut self) -> Result<(), RecognitionError>;

    /// Recognizes one checked frame.
    ///
    /// # Errors
    ///
    /// Returns a closed engine category without leaking native diagnostics.
    fn recognize(
        &mut self,
        frame: RecognitionFrame<'_>,
        language: RecognitionLanguage,
        segmentation: PageSegmentationMode,
    ) -> Result<RecognizedText, RecognitionError>;
}

pub(crate) fn recognize_gray(
    recognition: &mut dyn RecognitionPort,
    image: &GrayImage,
    language: RecognitionLanguage,
    segmentation: PageSegmentationMode,
) -> Result<RecognizedText, RecognitionError> {
    let frame = checked_frame(
        image.as_raw(),
        image.width(),
        image.height(),
        1,
        image.width(),
    )?;
    recognition.recognize(frame, language, segmentation)
}

pub(crate) fn recognize_color(
    recognition: &mut dyn RecognitionPort,
    image: &DynamicImage,
    language: RecognitionLanguage,
    segmentation: PageSegmentationMode,
) -> Result<RecognizedText, RecognitionError> {
    let rgb = image.to_rgb8();
    let bytes_per_line = rgb
        .width()
        .checked_mul(3)
        .ok_or(RecognitionError::Dimensions)?;
    let frame = checked_frame(rgb.as_raw(), rgb.width(), rgb.height(), 3, bytes_per_line)?;
    recognition.recognize(frame, language, segmentation)
}

fn checked_frame(
    bytes: &[u8],
    width: u32,
    height: u32,
    bytes_per_pixel: u8,
    bytes_per_line: u32,
) -> Result<RecognitionFrame<'_>, RecognitionError> {
    let expected_bytes = usize::try_from(bytes_per_line)
        .ok()
        .and_then(|line| {
            usize::try_from(height)
                .ok()
                .and_then(|rows| line.checked_mul(rows))
        })
        .ok_or(RecognitionError::Dimensions)?;
    if width == 0 || height == 0 || bytes.len() != expected_bytes {
        return Err(RecognitionError::Dimensions);
    }
    Ok(RecognitionFrame {
        bytes,
        width: i32::try_from(width).map_err(|_error| RecognitionError::Dimensions)?,
        height: i32::try_from(height).map_err(|_error| RecognitionError::Dimensions)?,
        bytes_per_pixel: i32::from(bytes_per_pixel),
        bytes_per_line: i32::try_from(bytes_per_line)
            .map_err(|_error| RecognitionError::Dimensions)?,
    })
}

fn normalize_text(value: &str) -> String {
    value
        .replace('　', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CapturingRecognizer {
        dimensions: Option<(i32, i32, i32, i32, usize)>,
    }

    impl RecognitionPort for CapturingRecognizer {
        fn initialize(&mut self) -> Result<(), RecognitionError> {
            Ok(())
        }

        fn recognize(
            &mut self,
            frame: RecognitionFrame<'_>,
            _language: RecognitionLanguage,
            _segmentation: PageSegmentationMode,
        ) -> Result<RecognizedText, RecognitionError> {
            self.dimensions = Some((
                frame.width(),
                frame.height(),
                frame.bytes_per_pixel(),
                frame.bytes_per_line(),
                frame.bytes().len(),
            ));
            Ok(RecognizedText::new("  桃鉄　社長\n", Some(0.9)))
        }
    }

    #[test]
    fn checked_frame_and_text_normalization_are_capability_owned() {
        let image = GrayImage::from_raw(2, 2, vec![0, 1, 2, 3]);
        assert!(image.is_some(), "the test image shape must be valid");
        let Some(image) = image else {
            return;
        };
        let mut recognizer = CapturingRecognizer { dimensions: None };
        let recognition_result = recognize_gray(
            &mut recognizer,
            &image,
            RecognitionLanguage::General,
            PageSegmentationMode::SingleLine,
        );
        assert!(
            recognition_result.is_ok(),
            "the checked image frame must be accepted"
        );
        assert_eq!(
            recognizer.dimensions,
            Some((2, 2, 1, 2, 4)),
            "native adapters must receive an internally consistent frame"
        );
        assert_eq!(
            recognition_result.ok().map(|value| value.text),
            Some(String::from("桃鉄 社長")),
            "native text normalization must remain deterministic"
        );
    }
}
