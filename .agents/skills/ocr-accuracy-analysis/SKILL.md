---
name: ocr-accuracy-analysis
description: Automate deep OCR accuracy analysis for momo-result's ocr_worker using apps/ocr-worker/scripts/eval_accuracy.py. Use when asked to evaluate, analyze, compare, or report OCR accuracy for the 桃鉄2 sample set under ocr_samples/003_桃鉄2, including optional per-match analysis by match number, answer TSV completion from the configured Google Sheet, debug artifact/image inspection, quantitative/qualitative reporting, root-cause reasoning, and concrete prioritized program-improvement proposals.
---

# OCR Accuracy Analysis

Use this skill to run and report 桃鉄2 OCR accuracy analysis with the in-repo OCR worker.

## Workflow

1. Run the bundled script from the repository root:

```sh
python3 .agents/skills/ocr-accuracy-analysis/scripts/run_momo2_accuracy.py [MATCH_NO]
```

2. If the user passed a number, pass it as `MATCH_NO` and analyze only that 対戦No. If no number is given, omit `MATCH_NO` and analyze every target image under `ocr_samples/003_桃鉄2`.

3. Let the script complete deterministic work:

- Select target image files from `ocr_samples/003_桃鉄2`.
- Use `ocr_samples/003_桃鉄2/answers.tsv` or `answer.tsv`.
- If required answer rows are missing, fetch the configured Google Sheet as TSV and append only the missing rows.
- Run `apps/ocr-worker/scripts/eval_accuracy.py`.
- Write a JSON report and a concise digest for AI analysis.

4. Read the generated digest first, then inspect the full JSON report when there are any diffs, warnings, failures, low-accuracy screen types, or skipped comparisons.

5. Inspect debug artifacts whenever the report includes a `debug_dir`, warnings, diffs, or failures. Do not treat debug output as optional background when accuracy is imperfect.

- Enumerate the relevant debug directory and identify the files tied to each diff or warning.
- For image artifacts, open the source image and focused debug images that can explain the error, such as `player_order/order_*_indicator.png`, row crops, cell crops, prepared images, Otsu outputs, sharpened fallbacks, and screen-detection artifacts.
- Compare the artifact to the expected value and the OCR result. Note whether the visible crop appears correct, over/under-cropped, blurred, thresholded poorly, contaminated by neighboring text, affected by color/indicator detection, or likely limited by OCR model behavior.
- If artifacts are missing or insufficient, say exactly what additional debug output should be added to make the failure diagnosable.

6. Report with exactly these sections in Japanese unless the user asks for a different format:

- `定量分析`: images, fields, accuracy, by-screen accuracy, failures, latency, and top diff hotspots.
- `定性分析`: observed OCR error patterns from diffs, warnings, affected screens/files, and debug artifact/image inspection. Include the artifact paths or path patterns that support the conclusion.
- `考察`: likely causes and confidence. Label inferences explicitly when they are inferred rather than directly measured.
- `改善提案`: up to 3 prioritized actions. Each action must include why it matters, risk if ignored, and the recommended next step.

## Script Usage

Analyze all target images:

```sh
python3 .agents/skills/ocr-accuracy-analysis/scripts/run_momo2_accuracy.py
```

Analyze only 対戦No. 7:

```sh
python3 .agents/skills/ocr-accuracy-analysis/scripts/run_momo2_accuracy.py 7
```

Useful options:

```sh
python3 .agents/skills/ocr-accuracy-analysis/scripts/run_momo2_accuracy.py 7 --mode timing --repeat 3
python3 .agents/skills/ocr-accuracy-analysis/scripts/run_momo2_accuracy.py 7 --prepare-only
```

The script calls:

```sh
uv run --project apps/ocr-worker python apps/ocr-worker/scripts/eval_accuracy.py
```

If dependency setup is missing, run `uv sync --project apps/ocr-worker` before retrying. If answer fetching fails because network access is blocked, rerun the same script with network approval.

## Reporting Guidance

Be exhaustive in analysis, but concise in the final report. Generate and reflect on broad hypotheses before narrowing to the most important findings. Continue analysis until every recommended program change is concrete enough for an engineer to start without asking "what should change?"

Prioritize these checks:

- Screen-type imbalance: identify whether `total_assets`, `revenue`, or `incident_log` dominates errors.
- Field hotspots: identify repeated misses for rank, money amounts, incident counters, or play order matching.
- Failure clusters: identify whether failures correlate with specific match numbers, maps, filename comments, warnings, or debug artifacts.
- Measurement integrity: distinguish OCR failures from missing answer rows, skipped comparisons, or `field_total == 0`.
- Debug artifact causality: for each important diff, determine whether the evidence points to source image quality, screen detection, crop geometry, preprocessing, player-order/indicator matching, OCR recognition, post-processing, or answer-data mismatch.

## Program-Improvement Proposal Gate

When the analysis indicates code changes may be needed, the `改善提案` section must be specific enough to define a programming task. Code is not required, but each proposal must identify:

- the likely component or file area to modify, such as screen detection, crop coordinate definitions, preprocessing, player-order detection, OCR invocation, parsing/post-processing, answer loading, or debug output;
- what should change, including the target algorithm/threshold/crop/debug artifact behavior and the expected effect;
- how to verify it, preferably by rerunning the same match or affected screen type and naming the metric or diff that should improve;
- any tradeoff or regression risk, especially when changing thresholds shared by multiple screen types.

Avoid vague proposals like "improve OCR" or "adjust preprocessing." Replace them with concrete actions such as "expand the incident-log numeric cell right boundary before preprocessing because the debug crop cuts off the digit; verify the `プラス駅` diff on match N disappears without increasing adjacent-cell false positives."

Do not overfit recommendations to one image unless the user explicitly asks for single-match tuning. When analyzing all images, prefer improvements that reduce repeated field-level errors across matches.
