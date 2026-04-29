from __future__ import annotations


def normalize_ocr_text(text: str) -> str:
    return " ".join(text.replace("\u3000", " ").split())
