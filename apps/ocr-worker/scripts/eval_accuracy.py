"""Standalone OCR accuracy evaluator for ocr_samples directories.

This script wraps `analyze_image()` so the AI agent can iterate on OCR tuning
without booting Redis/Postgres. It parses sample filenames, runs analyze in
`debug` or `timing` mode, compares the parsed draft to `answers.tsv`, and emits
both a per-image diff and an aggregate accuracy summary.

Filename convention (e.g. `桃鉄2_007_20251121_西日本_01総資産_<comment>.jpg`):
    {game}_{matchNo}_{yyyymmdd}_{map}_{slotPrefix}{slotName}[_{comment}].{ext}
    slotPrefix is one of: 01 (総資産) / 02 (収益額) / 03 (事件簿).

Suggested invocation (env loading + debug dir + AI loop friendly):

    set -a; source .env; set +a && \\
    MOMO_OCR_DEBUG_DIR=/tmp/momo-ocr-debug \\
    uv run python apps/ocr-worker/scripts/eval_accuracy.py \\
        --samples-dir ocr_samples/003_桃鉄2 \\
        --answers     ocr_samples/003_桃鉄2/answers.tsv \\
        --report      apps/ocr-worker/out/eval-momo2.json \\
        --mode debug

For pure timing measurement (no debug artifacts, repeats per image):

    set -a; source .env; set +a && \\
    uv run python apps/ocr-worker/scripts/eval_accuracy.py \\
        --samples-dir ocr_samples/003_桃鉄2 \\
        --answers     ocr_samples/003_桃鉄2/answers.tsv \\
        --mode timing --repeat 3 \\
        --report      apps/ocr-worker/out/eval-momo2-timing.json

The script intentionally processes every selected image in a single Python
process (no subprocess fan-out) so the AI agent can re-invoke it as a whole
between tuning iterations. `--repeat` is provided for inner-loop timing
measurements; outer-loop "run N times and compare" is left to the caller.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Make the in-repo package importable when invoked via `uv run python ...`.
_PKG_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_PKG_SRC) not in sys.path:
    sys.path.insert(0, str(_PKG_SRC))

from momo_ocr.features.ocr_domain.models import (  # noqa: E402
    OcrDraftPayload,
    PlayerResultDraft,
)
from momo_ocr.features.standalone_analysis.analyze_image import analyze_image  # noqa: E402
from momo_ocr.features.standalone_analysis.report import AnalysisResult  # noqa: E402

SLOT_PREFIX_TO_TYPE: dict[str, str] = {
    "01": "total_assets",
    "02": "revenue",
    "03": "incident_log",
}

INCIDENT_COLUMNS: tuple[str, ...] = (
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次",
)

# Compare predicted vs expected only on screens where the value is present.
TOTAL_ASSETS_COLUMNS = ("rank", "total_assets")
REVENUE_COLUMNS = ("revenue",)


@dataclass
class FilenameMeta:
    path: Path
    game: str
    match_no: int
    date: str
    map_name: str
    slot_prefix: str
    slot_name: str
    screen_type: str

    @property
    def stem(self) -> str:
        return self.path.stem


@dataclass
class ExpectedPlayer:
    play_order: int
    name: str
    rank: int | None
    total_assets: int | None
    revenue: int | None
    incidents: dict[str, int]


@dataclass
class ImageEval:
    file: str
    match_no: int
    screen_type: str
    duration_ms_mean: float
    duration_ms_min: float
    duration_ms_max: float
    repeats: int
    failure: str | None
    detected_screen_type: str | None
    profile_id: str | None
    field_total: int = 0
    field_correct: int = 0
    diffs: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    debug_dir: str | None = None


_FILENAME_RE = re.compile(
    r"^(?P<game>[^_]+)_(?P<match>\d+)_(?P<date>\d{8})_(?P<map>[^_]+)_"
    r"(?P<slot_prefix>\d{2})(?P<slot_name>[^_.]+)(?:_(?P<comment>[^.]+))?\."
    r"(?P<ext>jpg|jpeg|png|webp)$",
    re.IGNORECASE,
)


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
        if len(players) != 4:  # noqa: PLR2004
            sys.stderr.write(
                f"[warn] match {match_no} has {len(players)} player rows in answers.tsv\n"
            )
    return grouped


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


def _resolve_debug_dir(meta: FilenameMeta, mode: str, override: Path | None) -> Path | None:
    if mode != "debug":
        return None
    if override is not None:
        return override / meta.stem
    base = os.environ.get("MOMO_OCR_DEBUG_DIR", "").strip()
    if not base:
        return None
    return Path(base).expanduser() / meta.stem


def _player_by_play_order(payload: OcrDraftPayload, play_order: int) -> PlayerResultDraft | None:
    for player in payload.players:
        if player.play_order.value == play_order:
            return player
    return None


# Roster name → OCR name fragments (NFKC-lowercased).
# 答え合わせの answers.tsv 表記と OCR が返す canonical 名 (DEFAULT_STATIC_ALIASES)
# を結びつけるための薄いマッピング。play_order 検出が失敗した行を、
# 名前ベースで救済するためだけに使う。
_NAME_FRAGMENTS: dict[str, tuple[str, ...]] = {
    "おーたか": ("おーたか", "おたか", "オータカ", "オタカ", "オー夕カ"),
    "いーゆー": ("いーゆー", "いーゆ", "イーユー", "イーユ"),
    "ぽんた": ("ぽんた", "ほんた", "ぼんた", "ポンタ"),
    "あかねまみ": ("あかねまみ", "アカネマミ", "no11", "ＮＯ１１"),
    "さくま": ("さくま", "サクマ"),
}


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower()
    # OCR 由来のサフィックス・空白を除去し、含有判定を緩める。
    for suffix in ("社長", "さん"):
        normalized = normalized.replace(suffix, "")
    return "".join(ch for ch in normalized if not ch.isspace())


def _player_by_name(
    payload: OcrDraftPayload, expected_name: str
) -> PlayerResultDraft | None:
    fragments = _NAME_FRAGMENTS.get(expected_name)
    if not fragments:
        fragments = (expected_name,)
    norm_fragments = [_normalize_name(f) for f in fragments]
    for player in payload.players:
        raw = player.raw_player_name.value
        if raw is None:
            continue
        norm_raw = _normalize_name(raw)
        if any(frag and frag in norm_raw for frag in norm_fragments):
            return player
    return None


def _resolve_player(
    payload: OcrDraftPayload, expected: ExpectedPlayer
) -> tuple[PlayerResultDraft | None, str]:
    """Match expected → predicted player. Returns (player, match_kind).

    match_kind: 'play_order' | 'name' | 'none'
    """
    by_order = _player_by_play_order(payload, expected.play_order)
    if by_order is not None:
        return by_order, "play_order"
    by_name = _player_by_name(payload, expected.name)
    if by_name is not None:
        return by_name, "name"
    return None, "none"


def _compare_player(
    *,
    expected: ExpectedPlayer,
    predicted: PlayerResultDraft | None,
    screen_type: str,
    diffs: list[dict[str, Any]],
) -> tuple[int, int]:
    """Return (correct, total) for the predicted vs expected pair."""

    correct = 0
    total = 0

    def _record(field_name: str, exp: object, got: object) -> None:
        nonlocal correct, total
        total += 1
        if exp == got:
            correct += 1
        else:
            diffs.append(
                {
                    "play_order": expected.play_order,
                    "field": field_name,
                    "expected": exp,
                    "got": got,
                }
            )

    if predicted is None:
        diffs.append(
            {
                "play_order": expected.play_order,
                "field": "<player>",
                "expected": expected.name,
                "got": None,
            }
        )
        # Count per-field misses so accuracy reflects the missing player rows.
        if screen_type == "total_assets":
            return correct, total + len(TOTAL_ASSETS_COLUMNS)
        if screen_type == "revenue":
            return correct, total + len(REVENUE_COLUMNS)
        if screen_type == "incident_log":
            return correct, total + len(INCIDENT_COLUMNS)
        return correct, total

    if screen_type == "total_assets":
        _record("rank", expected.rank, predicted.rank.value)
        _record("total_assets", expected.total_assets, predicted.total_assets_man_yen.value)
    elif screen_type == "revenue":
        _record("revenue", expected.revenue, predicted.revenue_man_yen.value)
    elif screen_type == "incident_log":
        for col in INCIDENT_COLUMNS:
            got_field = predicted.incidents.get(col)
            got = got_field.value if got_field is not None else None
            _record(col, expected.incidents.get(col), got)
    return correct, total


def _evaluate_one(
    *,
    meta: FilenameMeta,
    expected_players: list[ExpectedPlayer] | None,
    debug_dir: Path | None,
    repeat: int,
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

    for expected in expected_players:
        predicted, match_kind = _resolve_player(last.result, expected)
        correct, total = _compare_player(
            expected=expected,
            predicted=predicted,
            screen_type=meta.screen_type,
            diffs=eval_record.diffs,
        )
        if predicted is not None and match_kind == "name":
            # play_order 検出が外れたが name 一致で値検証できたケースを記録。
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

    return eval_record


def _aggregate(records: list[ImageEval]) -> dict[str, Any]:
    total = sum(r.field_total for r in records)
    correct = sum(r.field_correct for r in records)
    by_screen: dict[str, dict[str, int]] = {}
    for r in records:
        bucket = by_screen.setdefault(r.screen_type, {"total": 0, "correct": 0, "images": 0})
        bucket["total"] += r.field_total
        bucket["correct"] += r.field_correct
        bucket["images"] += 1

    durations = [r.duration_ms_mean for r in records]
    return {
        "images": len(records),
        "fields_total": total,
        "fields_correct": correct,
        "accuracy": (correct / total) if total else None,
        "by_screen_type": {
            stype: {
                **stats,
                "accuracy": (
                    stats["correct"] / stats["total"] if stats["total"] else None
                ),
            }
            for stype, stats in by_screen.items()
        },
        "duration_ms": {
            "sum_mean": sum(durations),
            "min": min(durations) if durations else None,
            "max": max(durations) if durations else None,
            "mean": (sum(durations) / len(durations)) if durations else None,
        },
        "failures": [r.file for r in records if r.failure is not None or r.field_total == 0],
    }


def _select_files(
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate OCR accuracy against answers.tsv")
    parser.add_argument("--samples-dir", required=True, type=Path)
    parser.add_argument("--answers", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--mode", choices=("debug", "timing"), default="debug")
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Times to re-run analyze per image (timing mode); inner-loop only.",
    )
    parser.add_argument(
        "--debug-dir",
        type=Path,
        help="Override MOMO_OCR_DEBUG_DIR; only used in --mode debug.",
    )
    parser.add_argument(
        "--match",
        action="append",
        type=int,
        default=None,
        help="Restrict to one or more 対戦No. (repeatable).",
    )
    parser.add_argument(
        "--screen-types",
        action="append",
        choices=("01", "02", "03"),
        default=None,
        help="Restrict to one or more screen-type prefixes (01/02/03; repeatable).",
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only the aggregate summary to stdout (per-image diffs still go to --report).",
    )
    args = parser.parse_args(argv)

    samples_dir: Path = args.samples_dir
    if not samples_dir.is_dir():
        sys.stderr.write(f"samples-dir does not exist: {samples_dir}\n")
        return 2

    answers = load_answers(args.answers)
    matches = set(args.match) if args.match else None
    screen_prefixes = set(args.screen_types) if args.screen_types else None
    files = _select_files(samples_dir, matches, screen_prefixes, args.limit)
    if not files:
        sys.stderr.write("no samples matched the filters\n")
        return 2

    records: list[ImageEval] = []
    for meta in files:
        debug_dir = _resolve_debug_dir(meta, args.mode, args.debug_dir)
        record = _evaluate_one(
            meta=meta,
            expected_players=answers.get(meta.match_no),
            debug_dir=debug_dir,
            repeat=args.repeat if args.mode == "timing" else 1,
        )
        records.append(record)
        if not args.summary_only:
            acc = (
                f"{record.field_correct}/{record.field_total}"
                if record.field_total
                else "n/a"
            )
            sys.stderr.write(
                f"[{meta.match_no:03d}/{meta.slot_prefix}] {meta.path.name} "
                f"{acc} fields  {record.duration_ms_mean:.0f}ms"
                f"{'  FAIL=' + record.failure if record.failure else ''}\n"
            )

    summary = _aggregate(records)

    payload: dict[str, Any] = {
        "mode": args.mode,
        "repeat": args.repeat,
        "samples_dir": str(samples_dir),
        "summary": summary,
        "results": [r.__dict__ for r in records],
    }

    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0 if not summary["failures"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
