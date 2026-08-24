//! Checked numeric conversions shared by the analysis kernels.
//!
//! Rust deliberately has no infallible integer/float conversion API. Keeping the two casts that
//! the statistical kernels need behind range-checked functions prevents a future caller from
//! accidentally turning truncation, saturation, or precision loss into business data.

/// Converts an in-memory collection size to an exactly representable `f64` count.
///
/// The worker rejects inputs above its much smaller player-match bound, but this helper remains checked so
/// kernels also behave safely when called directly from tests or future tools.
pub(super) fn count_as_f64(value: usize) -> Option<f64> {
    u32::try_from(value).ok().map(f64::from)
}

pub(super) fn floor_i64(value: f64) -> Option<i64> {
    #[expect(
        clippy::as_conversions,
        clippy::cast_precision_loss,
        reason = "i64::MIN is exact in binary64 and i64::MAX rounds to the required exclusive 2^63 bound"
    )]
    const I64_RANGE: std::ops::Range<f64> = (i64::MIN as f64)..(i64::MAX as f64);

    let floored = value.floor();
    if !floored.is_finite() || !I64_RANGE.contains(&floored) {
        return None;
    }

    #[expect(
        clippy::as_conversions,
        clippy::cast_possible_truncation,
        reason = "the finite half-open i64 range check above makes this cast lossless"
    )]
    Some(floored as i64)
}

pub(super) fn ceil_i64(value: f64) -> Option<i64> {
    #[expect(
        clippy::as_conversions,
        clippy::cast_precision_loss,
        reason = "i64::MIN is exact in binary64 and i64::MAX rounds to the required exclusive 2^63 bound"
    )]
    const I64_RANGE: std::ops::Range<f64> = (i64::MIN as f64)..(i64::MAX as f64);

    let ceiled = value.ceil();
    if !ceiled.is_finite() || !I64_RANGE.contains(&ceiled) {
        return None;
    }

    #[expect(
        clippy::as_conversions,
        clippy::cast_possible_truncation,
        reason = "the finite half-open i64 range check above makes this cast lossless"
    )]
    Some(ceiled as i64)
}

pub(super) fn round_i64(value: f64) -> Option<i64> {
    floor_i64(value + 0.5)
}

pub(super) fn exact_i64_as_f64(value: i64) -> Option<f64> {
    const MAXIMUM_EXACT_INTEGER: i64 = 1_i64 << f64::MANTISSA_DIGITS;
    if !(-MAXIMUM_EXACT_INTEGER..=MAXIMUM_EXACT_INTEGER).contains(&value) {
        return None;
    }

    #[expect(
        clippy::as_conversions,
        clippy::cast_precision_loss,
        reason = "integers within ±2^53 are represented exactly by binary64"
    )]
    Some(value as f64)
}

pub(super) fn floor_u8(value: f64) -> Option<u8> {
    let floored = value.floor();
    if !floored.is_finite() || !(0.0..=f64::from(u8::MAX)).contains(&floored) {
        return None;
    }

    #[expect(
        clippy::as_conversions,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the finite inclusive u8 range check above makes this cast lossless"
    )]
    Some(floored as u8)
}

pub(super) fn floor_usize(value: f64) -> Option<usize> {
    finite_u32_to_usize(value.floor())
}

pub(super) fn ceil_usize(value: f64) -> Option<usize> {
    finite_u32_to_usize(value.ceil())
}

fn finite_u32_to_usize(value: f64) -> Option<usize> {
    if !value.is_finite() || !(0.0..=f64::from(u32::MAX)).contains(&value) {
        return None;
    }

    #[expect(
        clippy::as_conversions,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the finite inclusive u32 range check above makes this intermediate cast lossless"
    )]
    let bounded = value as u32;
    usize::try_from(bounded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_float_integer_boundaries_do_not_saturate() {
        assert_eq!(floor_i64(3.9), Some(3));
        assert_eq!(ceil_i64(-3.9), Some(-3));
        assert_eq!(floor_u8(100.9), Some(100));
        assert_eq!(floor_u8(-0.1), None);
        assert_eq!(floor_usize(f64::INFINITY), None);
        assert_eq!(round_i64(2.49), Some(2));
        assert_eq!(round_i64(2.5), Some(3));
        assert_eq!(round_i64(-2.5), Some(-2));
    }

    #[test]
    fn exact_binary64_conversion_rejects_precision_loss() {
        const LIMIT: i64 = 1_i64 << f64::MANTISSA_DIGITS;
        assert_eq!(exact_i64_as_f64(LIMIT), Some(9_007_199_254_740_992.0));
        assert_eq!(exact_i64_as_f64(LIMIT + 1), None);
    }
}
