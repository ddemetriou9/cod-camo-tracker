# Tracker Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live failure inspectable with one click and document the evidence needed for a better browser capture design.

**Architecture:** Add bounded in-memory instrumentation to the existing capture engine. The UI creates a frozen text snapshot on demand; runtime recognition and progress rules stay intact.

**Tech Stack:** Vanilla JavaScript, browser screen sharing, Tesseract.js, Playwright.

**Spec:** docs/superpowers/specs/2026-10-29-tracker-investigation.md

## Global Constraints
- Browser first, GitHub Pages, no installation required.
- Personal progress stays in localStorage.
- No screenshot files, frame history, audio capture or automatic uploads.
- Keep work during matches small; preserve manual progress and two-reading confirmation.

## Review Focus
- Clipboard denied: selected readonly report remains copyable.
- Background/covered tracker: visibility, frame movement and scan gaps are recorded without assuming browser timing guarantees.
- Rapid status transitions: copied snapshot never changes and per-mode rejection survives unrelated status updates.
- Long sessions: at most 80 events and bounded OCR text; no frame retention or persistent reports.
- Restart/Stop: evidence remains available after Stop; a fresh Start resets the session trail and carries no previous session input.

### Task 1: Stable evidence across engine boundaries
**Files:** web/browser-capture.js; tests/browser-diagnostics.cjs.
**Interface:** getDiagnosticReport(): string returns a frozen JSON text snapshot of current metadata and bounded evidence.
- [ ] Add assertions for one-click clipboard success/denial, snapshot stability, rejection retention, bounded history and absent image/progress content; run the existing diagnostic test to confirm failure before implementation.
- [ ] Record scheduling, frames, probes, worker lifecycle, OCR, parser failures and apply outcomes with bounded text payloads.
- [ ] Verify a new Start resets evidence; Stop preserves the report and still releases capture/OCR.

### Task 2: Copy/report UI and publication
**Files:** web/browser-tracker-ui.js; web/readability.css; web/index.html; README.md.
- [ ] Add prominent Copy diagnostic report plus a readonly snapshot and clipboard fallback.
- [ ] Verify failed and successful scans in one session, ordinary manual edits, denied clipboard and mobile layout.
- [ ] Run parser tests and the standalone HTML build; inspect publication diff for personal data and fixture files.
- [ ] Deploy through the existing Pages workflow and verify hosted build and report button.
- [ ] Report measured findings separately from unverified live hypotheses. Request the one-click report as evidence for the next recognition change.
