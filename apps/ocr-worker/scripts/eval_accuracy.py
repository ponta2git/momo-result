from __future__ import annotations

import sys
from pathlib import Path

# Make the in-repo packages importable when invoked via `uv run python ...`.
_SCRIPTS = Path(__file__).resolve().parent
_PKG_SRC = _SCRIPTS.parent / "src"
for path in (_SCRIPTS, _PKG_SRC):
    p = str(path)
    if p not in sys.path:
        sys.path.insert(0, p)

from eval_lib.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
