from __future__ import annotations

from PIL import Image, ImageOps

from momo_ocr.features.image_processing.geometry import FULL_HD, Size
from momo_ocr.shared.errors import FailureCode, OcrError

MIN_RELIABLE_WIDTH = 640
MIN_RELIABLE_HEIGHT = 360


def to_grayscale(image: Image.Image) -> Image.Image:
    return ImageOps.grayscale(image)


def normalize_to_full_hd(image: Image.Image) -> Image.Image:
    if image.size == (FULL_HD.width, FULL_HD.height):
        return image.copy()
    return image.resize((FULL_HD.width, FULL_HD.height), Image.Resampling.LANCZOS)


def ensure_supported_dimensions(size: Size) -> None:
    if size.width <= 0 or size.height <= 0:
        raise OcrError(FailureCode.INVALID_IMAGE, "Image dimensions must be positive.")
    if size.width < MIN_RELIABLE_WIDTH or size.height < MIN_RELIABLE_HEIGHT:
        raise OcrError(FailureCode.LAYOUT_UNSUPPORTED, "Image is too small for reliable OCR.")


def otsu_binarize(image: Image.Image) -> Image.Image:
    """Return a binarized variant using Otsu's threshold on a grayscale image.

    A固定閾値ベースの二値化は背景色 (例: 黄色背景に白い数字) で前景信号を完全に
    破壊してしまうため、ヒストグラムから自動でしきい値を決める Otsu を共通
    ユーティリティとして提供する。
    """
    gray = ImageOps.grayscale(image)
    histogram = gray.histogram()[:256]
    total = sum(histogram)
    if total == 0:
        return gray
    sum_total = sum(i * histogram[i] for i in range(256))
    sum_b = 0.0
    weight_b = 0
    max_var = 0.0
    threshold = 127
    for i in range(256):
        weight_b += histogram[i]
        if weight_b == 0:
            continue
        weight_f = total - weight_b
        if weight_f == 0:
            break
        sum_b += i * histogram[i]
        mean_b = sum_b / weight_b
        mean_f = (sum_total - sum_b) / weight_f
        between = weight_b * weight_f * (mean_b - mean_f) ** 2
        if between > max_var:
            max_var = between
            threshold = i
    binarized = gray.point(lambda value, threshold=threshold: 255 if value > threshold else 0)
    return binarized.convert("L")
