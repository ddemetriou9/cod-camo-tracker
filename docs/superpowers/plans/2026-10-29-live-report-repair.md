# Live Report Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the fixed-title rejection and OCR restart loop demonstrated by the live diagnostic report.

**Architecture:** Share a constrained fixed-label matcher across menu crop reading, sparse layout discovery and parsing. Measure worker idle time from its own creation/use rather than time since a recognised screen.

**Tech Stack:** Vanilla JavaScript, Tesseract.js, Playwright and Node assertions.

**Spec:** docs/superpowers/specs/2026-10-29-tracker-investigation.md (Live report findings and narrow repair).

## Global Constraints
- Browser first, GitHub Pages, no installation required.
- Personal progress stays in localStorage.
- No screenshot files, frame history, audio capture or automatic uploads.
- Keep work during matches small; preserve manual progress and two-reading confirmation.

## Review Focus
- An approximate screen label alone must never identify a weapon or unlock a camo.
- Unknown/ambiguous weapons, invalid totals and low confidence remain rejected.
- Rejected OCR after an aged idle must not destroy the freshly loaded worker.
- Real inactivity and Stop must still release OCR and capture.
- An unreadable results reward remains rejected; the supplied report does not prove a readable camo unlock was missed.

### Task 1: Fixed-label OCR correction
**Files:** web/reward-parser.js; web/browser-capture.js; tests/reward-parser.cjs; tests/browser-overview-ocr.cjs.
- [x] Reproduce the exact fixed-label corruption with a failing parser test and a browser test that substitutes only the title while using real OCR for weapon/category crops.
- [x] Add constrained two-substitution matching only for the fixed Camo Select heading; retain all independent weapon/counter/confidence gates.
- [x] Verify the exact corruption reads Han 86 Military 8/8 and Special 3/3; verify unrelated labels and unknown/ambiguous weapons remain rejected.

### Task 2: Current-worker idle lifecycle
**Files:** web/browser-capture.js; tests/browser-worker-idle.cjs.
- [x] Reproduce five worker starts where two are expected using virtual idle age and rejected OCR, with no false application.
- [x] Reset the worker activity timestamp on creation and real OCR use; retain confirmed-context activity, 15-second idle retirement and Stop cleanup.
- [x] Verify the rejected candidate reuses one current worker and later genuine inactivity still unloads it.

### Task 3: Regression validation and publication
**Files:** web/index.html; README.md; public source only.
- [ ] Run diagnostic/copy, lifecycle, menu-routing and fast-carousel regressions plus the manual edition builder.
- [ ] Inspect staged changes for private diagnostic report data or fixtures; deploy through Pages and verify the hosted build.
- [ ] Describe the two proven repairs separately from unverified results-card behaviour and request a normal in-game retry.
