from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.preprocessing import otsu_binarize
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.incident_log.models import IncidentLogRow
from momo_ocr.features.incident_log.postprocess import is_pure_pipe_noise, parse_count
from momo_ocr.features.incident_log.profile import (
    MVP_INCIDENT_NAMES,
    IncidentLogProfile,
    select_incident_log_profiles,
)
from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.player_order.detector import apply_player_order_to_column_players
from momo_ocr.features.temp_images.validation import open_decoded_image
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

COUNT_OCR_PSMS = (10, 13)
PLAYER_COUNT = 4
MAX_PLAUSIBLE_STOP_COUNT = 12
MAX_PLAUSIBLE_STOP_TOTAL = 14
MAX_PLAUSIBLE_GINJI_TOTAL = 2
GINJI_INCIDENT_NAME = "スリの銀次"
# 「|」「l」「i」のみで構成された OCR text は罫線の縦棒由来である可能性が高い。
# Tesseract の confidence がこの閾値未満の場合はノイズ扱いとし、digit 候補から外す。
PIPE_NOISE_CONFIDENCE_THRESHOLD = 0.6


@dataclass(frozen=True)
class IncidentParseAttempt:
    profile: IncidentLogProfile
    player_counts: list[dict[str, OcrField[int]]]
    warnings: list[OcrWarning]
    raw_snippets: dict[str, str]

    @property
    def missing_count(self) -> int:
        return sum(
            1 for counts in self.player_counts for field in counts.values() if field.value is None
        )


@dataclass(frozen=True)
class CountRecognitionResult:
    raw_text: str
    count: int | None
    confidence: float | None


@dataclass(frozen=True)
class IncidentLogParser:
    screen_type: ScreenType = ScreenType.INCIDENT_LOG

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        image = (
            context.image
            if context.image is not None
            else open_decoded_image(context.image_path)
        )
        image_size = Size(width=image.width, height=image.height)
        debug_dir = context.debug_dir / "incident_log" if context.debug_dir is not None else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        profiles = select_incident_log_profiles(context.layout_family_hint)
        attempts = [
            _parse_profile(
                context=context,
                image=image,
                image_size=image_size,
                profile=profile,
                debug_dir=debug_dir,
                isolate_debug=len(profiles) > 1,
            )
            for profile in profiles
        ]
        selected_attempt = min(attempts, key=lambda attempt: attempt.missing_count)

        warnings = [
            *context.warnings,
            *selected_attempt.warnings,
            *_plausibility_warnings(selected_attempt.player_counts),
        ]
        players = [PlayerResultDraft(incidents=counts) for counts in selected_attempt.player_counts]
        players = apply_player_order_to_column_players(players, context.player_order_detection)
        rows = [
            IncidentLogRow(
                raw_player_name=None,
                counts={
                    incident_name: selected_attempt.player_counts[player_index][incident_name].value
                    for incident_name in MVP_INCIDENT_NAMES
                },
                confidence=None,
                warnings=[
                    warning.code.value
                    for warning in warnings
                    if warning.field_path is not None
                    and warning.field_path.startswith(f"players[{player_index}].")
                ],
            )
            for player_index in range(PLAYER_COUNT)
        ]
        return OcrDraftPayload(
            requested_screen_type=context.requested_screen_type,
            detected_screen_type=context.detected_screen_type,
            profile_id=context.profile_id,
            players=players,
            category_payload={
                "status": "parsed",
                "parser": "incident_log",
                "layout_profile_id": selected_attempt.profile.id,
                "incident_names": MVP_INCIDENT_NAMES,
                "rows": rows,
                "player_order": context.player_order_detection,
                "include_raw_text": context.include_raw_text,
            },
            warnings=warnings,
            raw_snippets=selected_attempt.raw_snippets if context.include_raw_text else None,
        )


def _parse_profile(
    *,
    context: ScreenParseContext,
    image: Image.Image,
    image_size: Size,
    profile: IncidentLogProfile,
    debug_dir: Path | None,
    isolate_debug: bool,
) -> IncidentParseAttempt:
    profile_debug_dir = (
        debug_dir / profile.id if debug_dir is not None and isolate_debug else debug_dir
    )
    if profile_debug_dir is not None:
        profile_debug_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[OcrWarning] = []
    raw_snippets: dict[str, str] = {}
    cell_debug_records: list[dict[str, Any]] = []
    player_counts = [
        {incident_name: OcrField[int](value=None) for incident_name in MVP_INCIDENT_NAMES}
        for _ in range(PLAYER_COUNT)
    ]

    for row_profile in profile.row_profiles:
        for player_index, cell_roi in enumerate(row_profile.cell_rois):
            cell_image = crop_roi(image, scale_profile_rect_to_image(cell_roi, image_size))
            prepared_cell = _prepare_count_cell_image(cell_image)
            cell_debug: dict[str, Any] | None = None
            if profile_debug_dir is not None:
                suffix = f"{row_profile.incident_name}_player_{player_index + 1}"
                cell_image.save(profile_debug_dir / f"{suffix}_cell.png")
                prepared_cell.save(profile_debug_dir / f"{suffix}_cell_prepared.png")
                # DEBUG: 各セルの PSM 試行を後から検証できるよう構造化ログを溜める。
                # MOMO_OCR_DEBUG_DIR が無効なら profile_debug_dir 自体が None なので
                # 通常運用では完全に no-op。
                cell_debug = {
                    "incident_name": row_profile.incident_name,
                    "player_index": player_index,
                    "cell_image": f"{suffix}_cell.png",
                    "prepared_image": f"{suffix}_cell_prepared.png",
                    "variants": [],
                }
                cell_debug_records.append(cell_debug)

            recognition = _recognize_count_cell(
                context,
                cell_image,
                incident_name=row_profile.incident_name,
                debug_dir=profile_debug_dir,
                debug_suffix=f"{row_profile.incident_name}_player_{player_index + 1}",
                debug_sink=cell_debug,
            )
            if cell_debug is not None:
                cell_debug["final_count"] = recognition.count
                cell_debug["final_confidence"] = recognition.confidence
                cell_debug["final_raw_text"] = recognition.raw_text
            field_path = f"players[{player_index}].incidents[{row_profile.incident_name!r}]"
            raw_snippets[f"{row_profile.incident_name}_player_{player_index + 1}"] = (
                recognition.raw_text
            )
            if recognition.count is None:
                warnings.append(
                    _missing_count_warning(row_profile.incident_name, player_index, field_path)
                )
            player_counts[player_index][row_profile.incident_name] = OcrField(
                value=recognition.count,
                raw_text=recognition.raw_text,
                confidence=recognition.confidence,
            )

    if profile_debug_dir is not None and cell_debug_records:
        # DEBUG: ROI/前処理/PSM ごとの判断を一覧で確認できる JSON を吐く。
        summary = {
            "profile_id": profile.id,
            "image_size": {"width": image_size.width, "height": image_size.height},
            "incident_names": list(MVP_INCIDENT_NAMES),
            "cells": cell_debug_records,
        }
        (profile_debug_dir / "cells.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return IncidentParseAttempt(
        profile=profile,
        player_counts=player_counts,
        warnings=warnings,
        raw_snippets=raw_snippets,
    )


def _missing_count_warning(incident_name: str, player_index: int, field_path: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.MISSING_INCIDENT_COUNT,
        message=f"Could not read {incident_name} count for player column {player_index + 1}.",
        field_path=field_path,
    )


def _plausibility_warnings(player_counts: list[dict[str, OcrField[int]]]) -> list[OcrWarning]:
    warnings: list[OcrWarning] = []
    ginji_total = 0
    for player_index, counts in enumerate(player_counts):
        station_total = 0
        for incident_name, field in counts.items():
            if field.value is None:
                continue
            if incident_name == GINJI_INCIDENT_NAME:
                ginji_total += field.value
                continue
            station_total += field.value
            if field.value > MAX_PLAUSIBLE_STOP_COUNT:
                warnings.append(
                    _suspicious_count_warning(
                        field_path=f"players[{player_index}].incidents[{incident_name!r}]",
                        message=(
                            f"{incident_name} count for player column {player_index + 1} "
                            f"is {field.value}, which is high for a 12-turn game."
                        ),
                    )
                )
        if station_total > MAX_PLAUSIBLE_STOP_TOTAL:
            warnings.append(
                _suspicious_count_warning(
                    field_path=f"players[{player_index}].incidents",
                    message=(
                        f"Incident station-stop total for player column {player_index + 1} "
                        f"is {station_total}, which is high for a 12-turn game."
                    ),
                )
            )
    if ginji_total > MAX_PLAUSIBLE_GINJI_TOTAL:
        warnings.append(
            _suspicious_count_warning(
                field_path="players[].incidents['スリの銀次']",
                message=(f"スリの銀次 total is {ginji_total}, which is high for one 12-turn game."),
            )
        )
    return warnings


def _suspicious_count_warning(*, field_path: str, message: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.SUSPICIOUS_INCIDENT_COUNT,
        message=message,
        field_path=field_path,
    )


def _prepare_count_cell_image(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    enhanced = ImageEnhance.Contrast(gray).enhance(4.0)
    return enhanced.resize((enhanced.width * 5, enhanced.height * 5), Image.Resampling.LANCZOS)


def _prepare_fallback_count_cell_images(image: Image.Image) -> tuple[Image.Image, ...]:
    inner = image.crop((5, 2, image.width - 5, image.height - 2))
    gray = ImageOps.grayscale(inner)
    sharpened = ImageEnhance.Contrast(gray.filter(ImageFilter.SHARPEN)).enhance(5.0)
    # 固定閾値ではなく Otsu を使うことで、UI 配色に左右されずに前景文字を抽出する。
    binary = otsu_binarize(gray)
    return (
        sharpened.resize((inner.width * 5, inner.height * 5), Image.Resampling.LANCZOS),
        binary.resize((inner.width * 5, inner.height * 5), Image.Resampling.NEAREST),
    )


def _recognize_count_cell(
    context: ScreenParseContext,
    image: Image.Image,
    *,
    incident_name: str,
    debug_dir: Path | None = None,
    debug_suffix: str | None = None,
    debug_sink: dict[str, Any] | None = None,
) -> CountRecognitionResult:
    # 全候補（primary + fallback）を常に評価して多数決で count を確定する。
    # primary が UI 枠線由来の幻文字 ("lo"→10, "io"→10 等) を返した場合に
    # 後段の正しい読みを参照できるようにするため、早期リターンしない。
    max_plausible_count = _max_plausible_cell_count(incident_name)
    primary_image = _prepare_count_cell_image(image)
    fallback_images = _prepare_fallback_count_cell_images(image)
    variant_specs = (
        ("primary", primary_image),
        ("fb_sharpened", fallback_images[0]),
        ("fb_otsu", fallback_images[1]),
    )
    if debug_dir is not None and debug_suffix is not None:
        # DEBUG: primary は既に上位で保存済みなので fallback だけ追加保存。
        for label, variant_image in variant_specs[1:]:
            variant_image.save(debug_dir / f"{debug_suffix}_{label}.png")

    primary_sink = _new_variant_sink("primary") if debug_sink is not None else None
    primary = _recognize_count_cell_image(context, primary_image, debug_sink=primary_sink)
    if debug_sink is not None and primary_sink is not None:
        debug_sink["variants"].append(primary_sink)

    fallback_results: list[CountRecognitionResult] = []
    for label, variant_image in variant_specs[1:]:
        variant_sink = _new_variant_sink(label) if debug_sink is not None else None
        result = _recognize_count_cell_image(context, variant_image, debug_sink=variant_sink)
        fallback_results.append(result)
        if debug_sink is not None and variant_sink is not None:
            debug_sink["variants"].append(variant_sink)

    return _select_count_recognition(
        primary, fallback_results, max_plausible_count=max_plausible_count
    )


def _new_variant_sink(label: str) -> dict[str, Any]:
    return {"label": label, "psm_attempts": []}


@dataclass(frozen=True)
class _PsmAttempt:
    text: str
    count: int | None
    confidence: float | None


def _recognize_count_cell_image(
    context: ScreenParseContext,
    image: Image.Image,
    *,
    debug_sink: dict[str, Any] | None = None,
) -> CountRecognitionResult:
    # 複数 PSM の結果を個別に parse_count してから多数決する。
    # 旧実装は raw_text を " | " で連結して parse_count に渡していたが、
    # parse_count は reversed で最後の候補を優先するため "0 | lo" → 10 の
    # ような後勝ち誤読が起きていた。
    attempts: list[_PsmAttempt] = []
    snippets: list[str] = []
    for psm in COUNT_OCR_PSMS:
        recognized = context.text_engine.recognize(
            image,
            field=RecognitionField.INCIDENT_LOG,
            config=RecognitionConfig(
                language="eng",
                psm=psm,
                variables={"tessedit_char_whitelist": "0123456789OoIl|i"},
            ),
        )
        text = normalize_ocr_text(recognized.text)
        if text and text not in snippets:
            snippets.append(text)
        parsed = parse_count(text) if text else None
        # 罫線由来の縦棒ノイズを digit と取り違えるのを避ける。
        if (
            parsed is not None
            and is_pure_pipe_noise(text)
            and (recognized.confidence or 0.0) < PIPE_NOISE_CONFIDENCE_THRESHOLD
        ):
            parsed = None
        attempts.append(
            _PsmAttempt(
                text=text,
                count=parsed,
                confidence=recognized.confidence,
            )
        )
        if debug_sink is not None:
            debug_sink["psm_attempts"].append(
                {
                    "psm": psm,
                    "text": text,
                    "count": parsed,
                    "confidence": recognized.confidence,
                }
            )
    chosen_count, chosen_confidence = _vote_count(attempts)
    if debug_sink is not None:
        debug_sink["chosen_count"] = chosen_count
        debug_sink["chosen_confidence"] = chosen_confidence
    return CountRecognitionResult(
        raw_text=" | ".join(snippets),
        count=chosen_count,
        confidence=chosen_confidence,
    )


def _vote_count(attempts: list[_PsmAttempt]) -> tuple[int | None, float | None]:
    # 同じ count を返した試行のうち最も票の多いものを選び、信頼度はその票群の
    # 最大値を採用する。タイブレークは text の短さ（ノイズ少なめ）→ 信頼度の高さ。
    valid = [attempt for attempt in attempts if attempt.count is not None]
    if not valid:
        return None, None
    by_count: dict[int, list[_PsmAttempt]] = {}
    for attempt in valid:
        if attempt.count is None:
            continue
        by_count.setdefault(attempt.count, []).append(attempt)

    def sort_key(item: tuple[int, list[_PsmAttempt]]) -> tuple[int, int, float, int]:
        _, group = item
        votes = len(group)
        min_text_len = min(len(attempt.text) for attempt in group)
        max_conf = max((attempt.confidence or 0.0) for attempt in group)
        # 「テキストに実際の数字が含まれているか」を最優先する。
        # Tesseract は PSM 10/13 で短い digit を読むと confidence=0 を返すことが
        # 多く、conf 合計や max では正解 ("3" conf=0) が letter→0 alias 由来の
        # ノイズ ("oo"/"Oo" conf=0.05) に負けてしまう。
        # 一方、`parse_count` は letter 'O'/'o' を 0 にエイリアスしてカウント化
        # するため、has_digit=False の "0" 票は装飾シャドウの誤読である可能性が
        # 高い。
        has_any_digit = int(any(any(c.isdigit() for c in attempt.text) for attempt in group))
        return (-has_any_digit, -votes, -max_conf, min_text_len)

    chosen_count, chosen_group = min(by_count.items(), key=sort_key)
    confidences = [attempt.confidence for attempt in chosen_group if attempt.confidence is not None]
    chosen_confidence = max(confidences) if confidences else None
    return chosen_count, chosen_confidence


def _select_count_recognition(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> CountRecognitionResult:
    candidates = (primary, *fallback_results)
    snippets = [result.raw_text for result in candidates if result.raw_text]
    valid = [result for result in candidates if result.count is not None]
    if not valid:
        return CountRecognitionResult(
            raw_text=" | ".join(dict.fromkeys(snippets)),
            count=None,
            confidence=None,
        )

    plausible = [
        result
        for result in valid
        if result.count is not None and result.count <= max_plausible_count
    ]
    pool = plausible or valid
    by_count: dict[int, list[CountRecognitionResult]] = {}
    for result in pool:
        if result.count is None:
            continue
        by_count.setdefault(result.count, []).append(result)

    def sort_key(item: tuple[int, list[CountRecognitionResult]]) -> tuple[int, int, float, int]:
        _, group = item
        votes = len(group)
        # raw_text は variant 内で複数 PSM のスニペットが " | " 連結されている可能性が
        # あるため、最短パイプ区切り片の長さを採用する (ノイズ片で長くなった結果に
        # 引きずられないように)。
        min_text_len = min(
            min(
                (len(piece.strip()) for piece in result.raw_text.split("|") if piece.strip()),
                default=len(result.raw_text),
            )
            for result in group
        )
        max_conf = max((result.confidence or 0.0) for result in group)
        # `_vote_count` と同じ has_digit 優先ゲート。raw_text の "|"-連結断片の
        # いずれかに literal digit があれば has_any_digit=1。
        has_any_digit = int(
            any(
                any(c.isdigit() for c in piece)
                for result in group
                for piece in result.raw_text.split("|")
            )
        )
        return (-has_any_digit, -votes, -max_conf, min_text_len)

    chosen_count, chosen_group = min(by_count.items(), key=sort_key)
    confidences = [result.confidence for result in chosen_group if result.confidence is not None]
    base_confidence = max(confidences) if confidences else None
    # PSM/前処理間の合意度で confidence を減衰させる。
    # 1 票しかない場合と全票一致の場合では信頼度が違うため。
    agreement_factor = len(chosen_group) / max(len(pool), 1)
    final_confidence = (
        base_confidence * (0.5 + 0.5 * agreement_factor) if base_confidence is not None else None
    )
    return CountRecognitionResult(
        raw_text=" | ".join(dict.fromkeys(snippets)),
        count=chosen_count,
        confidence=final_confidence,
    )


def _max_plausible_cell_count(incident_name: str) -> int:
    if incident_name == GINJI_INCIDENT_NAME:
        return MAX_PLAUSIBLE_GINJI_TOTAL
    return MAX_PLAUSIBLE_STOP_COUNT
