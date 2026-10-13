# Native OCR fixture

`total-assets.png` is an original, programmatically drawn 1920 × 1080 input. It
contains four ranked rows with Japanese player labels and yen amounts, plus the
four colored player-order slots. It uses no private screenshots or game assets.
The intended values in `expected.json` are specified from the text drawn into the
image, independently of OCR output.

The committed PNG is used on Linux CI without a font or image-generation dependency.
To regenerate it on macOS with the system Hiragino Sans font:

```sh
swift apps/web/e2e/fixtures/ocr/generate.swift apps/web/e2e/fixtures/ocr/total-assets.png
```

This fixture checks native recognition and the assembled upload-to-review path.
It does not measure recognition accuracy on real game screenshots. Assert names,
amounts, and player order; confidence and raw recognized text may vary by native
engine build and are not the oracle.
