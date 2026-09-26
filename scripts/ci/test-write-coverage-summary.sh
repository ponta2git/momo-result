#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 - "${script_dir}/write-coverage-summary.py" <<'PY'
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

WRITER = Path(sys.argv.pop())


class CoverageSummaryTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "summary"

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def run_summary(self, subsystem, expected_status=0, allow_missing=False):
        command = [sys.executable, str(WRITER), subsystem, "--root", str(self.root),
                   "--out", str(self.output)]
        if allow_missing:
            command.append("--allow-missing")
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected_status, result.stderr)
        summary = json.loads((self.output / "raw-summary.json").read_text())
        markdown = (self.output / "summary.md").read_text()
        return summary, markdown

    def api_report(self, version="3.8.4"):
        # Native root attributes from ScoverageXmlWriter. Branch counts are not
        # provided here; Cobertura maps its line counts to these statement counts.
        return self.write(
            f"apps/api/target/scala-{version}/scoverage-report/scoverage.xml",
            '<scoverage statement-count="3" statements-invoked="1" '
            'statement-rate="33.33" branch-rate="50.00" version="1.0">'
            '<packages/></scoverage>',
        )

    def web_report(self):
        # Istanbul uses Unknown before any file is merged, and 100 for an empty
        # metric in a merged file. Both are distinct from a missing report.
        total = {
            "statements": {"covered": 1, "total": 3, "skipped": 0, "pct": 33.33},
            "branches": {"covered": 0, "total": 0, "skipped": 0, "pct": 100},
            "functions": {"covered": 0, "total": 0, "skipped": 0, "pct": "Unknown"},
            "lines": {"covered": 2, "total": 2, "skipped": 0, "pct": 100},
        }
        report = self.write("apps/web/coverage/coverage-summary.json", json.dumps({"total": total}))
        return report, total

    def test_api_reports_only_native_metrics(self):
        source = self.api_report()
        self.write(
            "apps/api/target/scala-3.8.4/coverage-report/cobertura.xml",
            '<coverage line-rate="0.33" lines-covered="1" lines-valid="3" '
            'branches-covered="1" branches-valid="2" branch-rate="0.50"/>',
        )
        summary, markdown = self.run_summary("api")
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["sourceReports"], [source.relative_to(self.root).as_posix()])
        self.assertEqual(summary["metrics"], {
            "statements": {"pct": 33.3, "covered": 1, "total": 3},
            "branches": {"pct": 50.0, "covered": None, "total": None},
        })
        self.assertIn("| branches | 50.0% | - |", markdown)

    def test_multiple_scala_reports_are_ambiguous(self):
        self.api_report("3.8.4")
        self.api_report("3.9.0")
        summary, _ = self.run_summary("api", expected_status=1, allow_missing=True)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["metrics"], {})
        self.assertIn("Ambiguous", summary["message"])

    def test_web_metrics_and_empty_observations(self):
        self.web_report()
        summary, markdown = self.run_summary("web")
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["metrics"], {
            "statements": {"pct": 33.3, "covered": 1, "total": 3},
            "branches": {"pct": 100, "covered": 0, "total": 0},
            "functions": {"pct": None, "covered": 0, "total": 0},
            "lines": {"pct": 100, "covered": 2, "total": 2},
        })
        self.assertIn("| functions | - | 0 / 0 |", markdown)

    def test_missing_report_is_not_zero_coverage(self):
        for subsystem in ("api", "web"):
            for allowed in (False, True):
                with self.subTest(subsystem=subsystem, allowed=allowed):
                    summary, markdown = self.run_summary(
                        subsystem, expected_status=0 if allowed else 1, allow_missing=allowed
                    )
                    self.assertEqual(summary["status"], "missing")
                    self.assertEqual(summary["metrics"], {})
                    self.assertIn("unavailable", markdown)

    def test_percentage_is_rounded_once_from_counts(self):
        path = self.api_report()
        path.write_text(path.read_text().replace('statement-count="3"', 'statement-count="223"')
                        .replace('statement-rate="33.33"', 'statement-rate="0.45"'))
        summary, markdown = self.run_summary("api")
        self.assertEqual(summary["metrics"]["statements"]["pct"], 0.4)
        self.assertIn("| statements | 0.4% | 1 / 223 |", markdown)

    def test_invalid_metrics_replace_previous_summary(self):
        self.web_report()
        self.run_summary("web")
        for field, value in (("pct", float("nan")), ("pct", 101), ("pct", 99),
                             ("pct", None), ("covered", 0.5), ("covered", True),
                             ("covered", -1), ("covered", 4)):
            with self.subTest(field=field, value=value):
                path, total = self.web_report()
                total["statements"][field] = value
                path.write_text(json.dumps({"total": total}))
                summary, markdown = self.run_summary("web", expected_status=1, allow_missing=True)
                self.assertEqual(summary["status"], "invalid")
                self.assertEqual(summary["metrics"], {})
                self.assertNotIn("| statements |", markdown)
        path, total = self.web_report()
        total["branches"]["pct"] = 50
        path.write_text(json.dumps({"total": total}))
        summary, _ = self.run_summary("web", expected_status=1)
        self.assertEqual(summary["status"], "invalid")

    def test_invalid_xml_percentage(self):
        path = self.api_report()
        path.write_text(path.read_text().replace('branch-rate="50.00"', 'branch-rate="NaN"'))
        summary, _ = self.run_summary("api", expected_status=1)
        self.assertEqual(summary["status"], "invalid")

    def test_malformed_reports(self):
        for subsystem in ("api", "web"):
            with self.subTest(subsystem=subsystem):
                path = self.api_report() if subsystem == "api" else self.web_report()[0]
                path.write_text("<broken" if subsystem == "api" else "{broken")
                summary, _ = self.run_summary(subsystem, expected_status=1, allow_missing=True)
                self.assertEqual(summary["status"], "invalid")


unittest.main()
PY
