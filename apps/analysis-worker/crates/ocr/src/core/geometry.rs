use image::DynamicImage;
use thiserror::Error;

const PROFILE_WIDTH: u32 = 1920;
const PROFILE_HEIGHT: u32 = 1080;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Rect {
    pub(crate) x: u32,
    pub(crate) y: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(crate) enum GeometryError {
    #[error("OCR crop geometry exceeds the decoded image")]
    OutOfBounds,
    #[error("OCR crop geometry overflowed its bounded coordinates")]
    Overflow,
}

pub(crate) fn scale_profile_rect(
    rect: Rect,
    image_width: u32,
    image_height: u32,
) -> Result<Rect, GeometryError> {
    let scaled = Rect {
        x: scale_half_even(rect.x, image_width, PROFILE_WIDTH)?,
        y: scale_half_even(rect.y, image_height, PROFILE_HEIGHT)?,
        width: scale_half_even(rect.width, image_width, PROFILE_WIDTH)?,
        height: scale_half_even(rect.height, image_height, PROFILE_HEIGHT)?,
    };
    validate(scaled, image_width, image_height)?;
    Ok(scaled)
}

pub(crate) fn crop(image: &DynamicImage, rect: Rect) -> Result<DynamicImage, GeometryError> {
    validate(rect, image.width(), image.height())?;
    Ok(image.crop_imm(rect.x, rect.y, rect.width, rect.height))
}

fn scale_half_even(value: u32, target: u32, source: u32) -> Result<u32, GeometryError> {
    let numerator = u64::from(value)
        .checked_mul(u64::from(target))
        .ok_or(GeometryError::Overflow)?;
    let denominator = u64::from(source);
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;
    let doubled_remainder = remainder.checked_mul(2).ok_or(GeometryError::Overflow)?;
    let rounded = if doubled_remainder > denominator
        || (doubled_remainder == denominator && quotient % 2 == 1)
    {
        quotient.checked_add(1).ok_or(GeometryError::Overflow)?
    } else {
        quotient
    };
    u32::try_from(rounded).map_err(|_conversion_error| GeometryError::Overflow)
}

fn validate(rect: Rect, image_width: u32, image_height: u32) -> Result<(), GeometryError> {
    if rect.width == 0
        || rect.height == 0
        || rect
            .x
            .checked_add(rect.width)
            .is_none_or(|right| right > image_width)
        || rect
            .y
            .checked_add(rect.height)
            .is_none_or(|bottom| bottom > image_height)
    {
        return Err(GeometryError::OutOfBounds);
    }
    Ok(())
}
