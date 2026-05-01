"""Allow `python -m eval_lib --samples-dir ... --answers ...` invocation."""

from eval_lib.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
