# Self-hosted OCR assets

Loaded only when the user starts browser tracking. All runtime requests use this website's own origin. No game images or OCR text are transmitted.

- Tesseract.js **6.0.1**, Apache-2.0, API and worker bundles. See LICENSE.md and the two bundle LICENSE.txt notices for included dependency notices.
- Tesseract.js-core **6.0.0**, Apache-2.0, LSTM SIMD and non-SIMD variants. Only the compatible variant is loaded, in a single worker. See core/LICENSE.
- tessdata_fast English data pinned to **87416418657359cb625c412a48b6e1d6d41c29bd**, Apache-2.0. See lang/LICENSE.

Source URLs and SHA-256 checksums are recorded in checksums.json. Reproduce with `python tools/vendor-ocr.py` from the repository root. English recognition only; the parser targets the supplied 16:9 game results layout.
