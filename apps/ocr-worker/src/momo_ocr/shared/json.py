from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]


def to_jsonable(value: object) -> JsonValue:
    if is_dataclass(value) and not isinstance(value, type):
        result = to_jsonable(asdict(value))
    elif isinstance(value, dict):
        result = {str(key): to_jsonable(item) for key, item in value.items()}
    elif isinstance(value, list | tuple):
        result = [to_jsonable(item) for item in value]
    elif isinstance(value, Path):
        result = str(value)
    elif value is None or isinstance(value, bool | int | float | str):
        result = value
    else:
        result = str(value)
    return result


def dumps_json(value: object) -> str:
    return json.dumps(to_jsonable(value), ensure_ascii=False, indent=2, sort_keys=True)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps_json(value) + "\n", encoding="utf-8")
