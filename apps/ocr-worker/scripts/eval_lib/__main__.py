"""Allow `python -m eval_lib --samples-dir ... --answers ...` invocation."""

from __future__ import annotations

from eval_lib.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
