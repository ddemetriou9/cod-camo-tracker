# Browser tracker investigation

## Confirmed facts
- Jimmy sees clear game pixels in preview, but automatic menu/results checks do not reliably update progress.
- An explicit scan partially populated Han 86. The user cannot capture rapidly changing status text.
- Local fixtures pass; that is not evidence of live capture reliability.
- Current implementation reads a 1px video element, uses fixed colour/crop probes, and unloads OCR after 15 seconds without a confirmed screen. It does not record actual scheduling gaps or preserve per-mode rejected input for copying.

## Constraints
- Browser first, GitHub Pages, no installation required.
- Personal progress stays in localStorage.
- No screenshot files, frame history, audio capture or automatic uploads.
- Keep work during matches small; preserve manual progress and two-reading confirmation.

## Research
- Tesseract.js explicitly recommends reusing workers: https://raw.githubusercontent.com/naptha/tesseract.js/master/docs/performance.md
- Tesseract recommends appropriate segmentation, borders and suitable preprocessing: https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html
- Chrome background timer policy describes one-second batching and conditional intensive throttling: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- Background frame presentation is browser-dependent: https://github.com/WICG/video-rvfc/issues/92
- ImageCapture.grabFrame returns an ImageBitmap directly from a video track: https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/grabFrame
- MediaStreamTrackProcessor has limited availability and incompatible browser exposure: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor

## Recommended direction and alternatives
Recommend a measured, frame-driven browser pipeline: verify frame delivery and cadence first, calibrate text regions once, then classify screens and OCR bounded changed regions. Prefer a supported MediaStreamTrackProcessor frame stream over polling timers or presentation callbacks, with explicit feature detection for Chrome/Edge exposure. ImageCapture alone does not solve timer throttling if calls are still scheduled by a hidden-page timer. Browser documentation describes restrictions, not proof that a given live share is throttled; measure actual gaps and visibility transitions before changing it. Keep a single idle worker if measured reload costs cause missed cards, after measuring its memory cost. Test direct-track frame acquisition as an alternative to video presentation only if reports show stale video frames. A Windows companion is the fallback if browser background scheduling cannot meet the result-card duration; it is not the default and is not required by this change. New ML models and full-frame continuous OCR add cost without evidence that model quality is the current failure.

## Deliverable now
Add a bounded, text-only evidence trail across capture, scheduling, OCR, parsing and apply. A prominent Copy diagnostic report button freezes a snapshot and copies it; clipboard denial reveals a selected readonly textbox. No catching messages, manual screenshots, disk persistence or uploads. Preserve latest rejected text per read mode independently of the rolling event history. Include build, dimensions, visibility, frame movement age, actual scan gap, worker starts, probe mode, OCR input/output summary and application result. Do not collect device labels, share tokens, profile data or the user's progress database.

## Evidence required before changing recognition
One live report spanning a camo menu and an after-match failure. Compare pixel gates, actual frames, OCR output, rejection and save result. Reproduce that failure in a focused test before changing capture, confidence gates or recognition. The retained local tests remain regressions, not a live success claim.
