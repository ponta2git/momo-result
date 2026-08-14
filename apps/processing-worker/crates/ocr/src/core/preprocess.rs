use image::{DynamicImage, GrayImage, Luma, imageops::FilterType};

const COUNT_SCALE: u32 = 5;
const NAME_SCALE: u32 = 2;

pub(crate) fn otsu_binarize(image: &GrayImage) -> GrayImage {
    let mut histogram = [0_u64; 256];
    for pixel in image.pixels() {
        if let Some(bucket) = histogram.get_mut(usize::from(pixel.0[0])) {
            *bucket = bucket.saturating_add(1);
        }
    }
    let total = u64::from(image.width()) * u64::from(image.height());
    if total == 0 {
        return image.clone();
    }
    let sum_total = histogram
        .iter()
        .enumerate()
        .fold(0_u64, |sum, (index, count)| {
            sum.saturating_add(
                u64::try_from(index)
                    .unwrap_or(u64::MAX)
                    .saturating_mul(*count),
            )
        });
    let mut sum_background = 0_u64;
    let mut background_weight = 0_u64;
    let mut maximum_variance = 0.0_f64;
    let mut threshold = 127_u8;
    for (index, count) in histogram.iter().enumerate() {
        background_weight = background_weight.saturating_add(*count);
        if background_weight == 0 {
            continue;
        }
        let foreground_weight = total.saturating_sub(background_weight);
        if foreground_weight == 0 {
            break;
        }
        sum_background = sum_background.saturating_add(
            u64::try_from(index)
                .unwrap_or(u64::MAX)
                .saturating_mul(*count),
        );
        let background_mean = bounded_f64(sum_background) / bounded_f64(background_weight);
        let foreground_mean =
            bounded_f64(sum_total.saturating_sub(sum_background)) / bounded_f64(foreground_weight);
        let difference = background_mean - foreground_mean;
        let variance = bounded_f64(background_weight)
            * bounded_f64(foreground_weight)
            * difference
            * difference;
        if variance > maximum_variance {
            maximum_variance = variance;
            threshold = u8::try_from(index).unwrap_or(u8::MAX);
        }
    }
    GrayImage::from_fn(image.width(), image.height(), |x, y| {
        Luma([if image.get_pixel(x, y).0[0] > threshold {
            u8::MAX
        } else {
            0
        }])
    })
}

pub(crate) fn contrast(image: &GrayImage, factor: f64) -> GrayImage {
    if image.is_empty() {
        return image.clone();
    }
    let sum = image
        .pixels()
        .fold(0_u64, |current, pixel| current + u64::from(pixel.0[0]));
    let count = u64::from(image.width()) * u64::from(image.height());
    let mean = bounded_f64(sum) / bounded_f64(count);
    GrayImage::from_fn(image.width(), image.height(), |x, y| {
        let value = f64::from(image.get_pixel(x, y).0[0]);
        let adjusted = factor.mul_add(value - mean, mean);
        Luma([clamped_byte(adjusted)])
    })
}

pub(crate) fn invert(image: &GrayImage) -> GrayImage {
    GrayImage::from_fn(image.width(), image.height(), |x, y| {
        Luma([u8::MAX - image.get_pixel(x, y).0[0]])
    })
}

pub(crate) fn prepare_ranked_row_variants(image: &DynamicImage) -> Vec<GrayImage> {
    let gray = image.to_luma8();
    let enhanced = contrast(&gray, 2.0);
    let base = resize(&enhanced, 2, FilterType::Lanczos3);
    let inverted = (mean_luminance(&gray) < 110.0).then(|| invert(&base));
    let binarized = otsu_binarize(&base);
    let mut variants = Vec::with_capacity(if inverted.is_some() { 3 } else { 2 });
    variants.push(base);
    if let Some(inverted) = inverted {
        variants.push(inverted);
    }
    variants.push(binarized);
    variants
}

pub(crate) fn prepare_slot_name_variants(image: &DynamicImage) -> Vec<GrayImage> {
    let gray = image.to_luma8();
    let mut variants = Vec::with_capacity(3);
    for threshold in [150_u8, 170, 190] {
        let prepared = GrayImage::from_fn(gray.width(), gray.height(), |x, y| {
            Luma([if gray.get_pixel(x, y).0[0] > threshold {
                0
            } else {
                u8::MAX
            }])
        });
        variants.push(resize(&prepared, NAME_SCALE, FilterType::Lanczos3));
    }
    variants
}

pub(crate) fn prepare_count_cell(image: &DynamicImage) -> GrayImage {
    let enhanced = contrast(&image.to_luma8(), 4.0);
    resize(&enhanced, COUNT_SCALE, FilterType::Lanczos3)
}

pub(crate) fn prepare_fallback_count_cells(image: &DynamicImage) -> Vec<GrayImage> {
    let inner = bounded_inner_crop(image, 5, 2, 5, 2);
    let gray = inner.to_luma8();
    let sharpened = contrast(&sharpen(&gray), 5.0);
    let binary = otsu_binarize(&gray);
    vec![
        resize(&sharpened, COUNT_SCALE, FilterType::Lanczos3),
        resize(&binary, COUNT_SCALE, FilterType::Nearest),
    ]
}

pub(crate) fn prepare_digit_count_cells(image: &DynamicImage) -> Vec<GrayImage> {
    let right = image.width().min(60);
    let left = 10_u32.min(right.saturating_sub(1));
    let top = 6_u32.min(image.height().saturating_sub(1));
    let bottom = image.height().saturating_sub(5).max(top.saturating_add(1));
    let digit = image.crop_imm(left, top, right.saturating_sub(left), bottom - top);
    let gray = digit.to_luma8();
    let sharpened = contrast(&sharpen(&gray), 5.0);
    let binary = otsu_binarize(&gray);
    vec![
        resize(&sharpened, COUNT_SCALE, FilterType::Lanczos3),
        resize(&binary, COUNT_SCALE, FilterType::Nearest),
    ]
}

fn resize(image: &GrayImage, scale: u32, filter: FilterType) -> GrayImage {
    image::imageops::resize(
        image,
        image.width().saturating_mul(scale),
        image.height().saturating_mul(scale),
        filter,
    )
}

fn bounded_inner_crop(
    image: &DynamicImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
) -> DynamicImage {
    let x = left.min(image.width().saturating_sub(1));
    let y = top.min(image.height().saturating_sub(1));
    let width = image.width().saturating_sub(x).saturating_sub(right).max(1);
    let height = image
        .height()
        .saturating_sub(y)
        .saturating_sub(bottom)
        .max(1);
    image.crop_imm(x, y, width, height)
}

fn sharpen(image: &GrayImage) -> GrayImage {
    image::imageops::filter3x3(
        image,
        &[
            -0.125, -0.125, -0.125, -0.125, 2.0, -0.125, -0.125, -0.125, -0.125,
        ],
    )
}

fn mean_luminance(image: &GrayImage) -> f64 {
    if image.is_empty() {
        return 255.0;
    }
    let sum = image
        .pixels()
        .fold(0_u64, |current, pixel| current + u64::from(pixel.0[0]));
    let count = u64::from(image.width()) * u64::from(image.height());
    bounded_f64(sum) / bounded_f64(count)
}

#[expect(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the value is rounded and clamped to the exact u8 range before conversion"
)]
fn clamped_byte(value: f64) -> u8 {
    value.round().clamp(0.0, f64::from(u8::MAX)) as u8
}

fn bounded_f64(value: u64) -> f64 {
    f64::from(u32::try_from(value).unwrap_or(u32::MAX))
}
