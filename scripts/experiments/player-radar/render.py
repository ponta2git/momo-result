#!/usr/bin/env python3
"""Build a self-contained local review page from an already calculated report."""

import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
if args.output.resolve() == args.report.resolve():
    parser.error('Output must not overwrite report')
report = json.loads(args.report.read_text())
if report.get('schemaVersion') != 'mom30-report-v3':
    parser.error('Rebuild the report with analyze.py; this page requires mom30-report-v3')
payload = json.dumps(report, ensure_ascii=False, allow_nan=False).replace('<', '\\u003c')
template = Path(__file__).with_name('view.html').read_text()
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(template.replace('__MOM30_REPORT__', payload))
print(args.output)
