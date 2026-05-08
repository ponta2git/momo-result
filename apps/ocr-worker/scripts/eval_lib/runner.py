"""Filename parsing, answers.tsv loading, per-image evaluation, file selection."""

from __future__ import annotations

import csv
import os
import re
import sys
import time
from pathlib import Path

from eval_lib.comparator import compare_player
from eval_lib.matcher import resolve_player
from eval_lib.types import (
    INCIDENT_COLUMNS,
    SLOT_PREFIX_TO_TYPE,
    ExpectedPlayer,
    FilenameMeta,
    ImageEval,
)
from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine

_FILENAME_RE = re.compile(
    r"^(?P<game>[^_]+)_(?P<match>\d+)_(?P<date>\d{8})_(?P<map>[^_]+)_"
    r"(?P<slot_prefix>\d{2})(?P<slot_name>[^_.]+)(?:_(?P<comment>[^.]+))?\."
    r"(?P<ext>jpg|jpeg|png|webp)$",
    re.IGNORECASE,
)

_PLAYERS_PER_MATCH = 4


def parse_filename(path: Path) -> FilenameMeta | None:
    m = _FILENAME_RE.match(path.name)
    if m is None:
        return None
    slot_prefix = m.group("slot_prefix")
    screen_type = SLOT_PREFIX_TO_TYPE.get(slot_prefix)
    if screen_type is None:
        return None
    return FilenameMeta(
        path=path,
        game=m.group("game"),
        match_no=int(m.group("match")),
        date=m.group("date"),
        map_name=m.group("map"),
        slot_prefix=slot_prefix,
        slot_name=m.group("slot_name"),
        screen_type=screen_type,
    )


def _to_int(value: str | None) -> int | None:
    if value is None:
        return None
    stripped = value.strip()
    if stripped == "":
        return None
    try:
        return int(stripped)
    except ValueError:
        return None


def load_answers(tsv_path: Path) -> dict[int, list[ExpectedPlayer]]:
    grouped: dict[int, list[ExpectedPlayer]] = {}
    with tsv_path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            match_no = int(row["対戦No."])
            incidents = {col: _to_int(row.get(col)) or 0 for col in INCIDENT_COLUMNS}
            grouped.setdefault(match_no, []).append(
                ExpectedPlayer(
                    play_order=int(row["プレー順"]),
                    name=row["プレーヤー名"].strip(),
                    rank=_to_int(row.get("順位")),
                    total_assets=_to_int(row.get("総資産")),
                    revenue=_to_int(row.get("収益")),
                    incidents=incidents,
                )
            )
    for match_no, players in grouped.items():
        players.sort(key=lambda p: p.play_order)
        if len(players) != _PLAYERS_PER_MATCH:
            sys.stderr.write(
                f"[warn] match {match_no} has {len(players)} player rows in answers.tsv\n"
            )
    return grouped


def resolve_debug_dir(meta: FilenameMeta, mode: str, override: Path | None) -> Path | None:
    if mode != "debug":
        return None
    if override is not None:
        return override / meta.stem
    base = os.environ.get("MOMO_OCR_DEBUG_DIR", "").strip()
    if not base:
        return None
    return Path(base).expanduser() / meta.stem


def evaluate_one(
    *,
    meta: FilenameMeta,
    expected_players: list[ExpectedPlayer] | None,
    debug_dir: Path | None,
    repeat: int,
    text_engine: TextRecognitionEngine,
) -> ImageEval:
    durations: list[float] = []
    last: AnalysisResult | None = None
    for _ in range(max(1, repeat)):
        started = time.perf_counter()
        last = analyze_image(
            image_path=meta.path,
            requested_screen_type=meta.screen_type,
            debug_dir=debug_dir,
            include_raw_text=False,
            text_engine=text_engine,
        )
        durations.append((time.perf_counter() - started) * 1000.0)

    assert last is not None  # noqa: S101 - guaranteed by max(1, repeat)
    mean = sum(durations) / len(durations)
    eval_record = ImageEval(
        file=meta.path.name,
        match_no=meta.match_no,
        screen_type=meta.screen_type,
        duration_ms_mean=mean,
        duration_ms_min=min(durations),
        duration_ms_max=max(durations),
        repeats=len(durations),
        failure=last.failure_code,
        detected_screen_type=(
            last.detection.detected_type.value
            if last.detection is not None and last.detection.detected_type is not None
            else None
        ),
        profile_id=last.detection.profile_id if last.detection is not None else None,
        warnings=[f"{w.code.value}:{w.message}" for w in last.warnings],
        debug_dir=str(debug_dir) if debug_dir is not None else None,
    )

    if last.result is None or expected_players is None:
        if last.result is None:
            eval_record.diffs.append({"field": "<analysis>", "got": None, "expected": "result"})
        return eval_record

    player_order_stats = {
        "direct_total": 0,
        "direct_matches": 0,
        "fallback_name_matches": 0,
        "unresolved_players": 0,
    }
    for expected in expected_players:
        predicted, match_kind = resolve_player(last.result, expected)
        player_order_stats["direct_total"] += 1
        if match_kind == "play_order":
            player_order_stats["direct_matches"] += 1
        elif match_kind == "name":
            player_order_stats["fallback_name_matches"] += 1
        else:
            player_order_stats["unresolved_players"] += 1
        correct, total = compare_player(
            expected=expected,
            predicted=predicted,
            screen_type=meta.screen_type,
            diffs=eval_record.diffs,
        )
        if predicted is not None and match_kind == "name":
            eval_record.diffs.append(
                {
                    "play_order": expected.play_order,
                    "field": "<play_order_missed>",
                    "expected": expected.play_order,
                    "got": predicted.play_order.value,
                }
            )
        eval_record.field_correct += correct
        eval_record.field_total += total

    total = player_order_stats["direct_total"]
    eval_record.diagnostics["player_order"] = {
        **player_order_stats,
        "direct_accuracy": (player_order_stats["direct_matches"] / total if total else None),
    }
    return eval_record


def select_files(
    samples_dir: Path,
    matches: set[int] | None,
    screen_prefixes: set[str] | None,
    limit: int | None,
) -> list[FilenameMeta]:
    items: list[FilenameMeta] = []
    for path in sorted(samples_dir.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        meta = parse_filename(path)
        if meta is None:
            continue
        if matches is not None and meta.match_no not in matches:
            continue
        if screen_prefixes is not None and meta.slot_prefix not in screen_prefixes:
            continue
        items.append(meta)
    items.sort(key=lambda m: (m.match_no, m.slot_prefix))
    if limit is not None:
        items = items[:limit]
    return items
