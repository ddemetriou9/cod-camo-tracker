# Browser reward detection implementation plan

Goal: implement the user's selected website-only approach, recognising after-match camo reward cards automatically with minimal work during matches.

Architecture: keep the existing manual UI and optional companion unchanged. Separate pure reward parsing, browser capture/OCR scheduling, and UI integration. Screen frames never leave the browser and are never persisted. Vendor pinned OCR assets so no CDN is needed. The single-file manual edition remains capture-free.

Selected approach: browser screen sharing, chosen by the user over a Windows helper or manual screenshots. A small colour probe runs every two seconds; OCR runs only for a potential results banner. Request one-frame-per-second capture, use one OCR worker and cropped regions, serialise scans, cache identical crops, and terminate capture and OCR on Stop. Browser capture itself still has overhead; do not promise an FPS result.

- [x] Add strict pure parsing: require a results banner, exactly one known weapon and an explicit camo reward. Military rewards complete their sequential prefix. Match named camos only within that weapon. Reject level/unlock totals and attachment cards.
- [x] Vendor Tesseract.js 6.0.1, compatible core and pinned fast English data with licences and checksums. Load only after Start.
- [x] Implement capture start/cancel/stop/end/error lifecycle, region probes, serial OCR, stable-reading confirmation and duplicate suppression. Use generation guards against late async results.
- [x] Integrate visible status, accessible Start/Stop controls and recent applied rewards. Preserve manual corrections and existing browser storage.
- [x] Test actual supplied images through browser WASM OCR, false positives, duplicate reads, manual overrides, cancellation/stop and mocked display streams. Run the existing public UI smoke test and manual builder.
- [ ] Document limits, commit and deploy to the already-authorised GitHub repository. Verify the deployed release.

Review focus: a reward belongs to the weapon in the same captured frame; animations cannot create inferred levels; stale jobs cannot write after Stop; the banner probe must not run OCR continuously on gameplay; no user screenshot or personal data enters the repository. Initial support targets the supplied 16:9 results layout. Short reward cards and unreadable/custom layouts can be missed.
