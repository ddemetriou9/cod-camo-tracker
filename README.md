# COD Camo Tracker — MW4 Fieldnotes

A buildless HTML/JavaScript camo planner with weapon checklists, requirements, reference graphics and up to six next-match goals.

## Use the website

Open https://ddemetriou9.github.io/cod-camo-tracker/ . No account, installation or local server is required for manual tracking.

Click a Military square to complete it and every earlier Military square. Special and finish squares toggle individually. Hover a camo for its requirement and Track button. Open a weapon for its full checklist and editable counters.

Progress is stored in this browser's localStorage; pictures you deliberately add use IndexedDB. No progress is uploaded. Clearing site data removes it. Use Export plan for backups and Import to move progress between browsers, devices, or the local and hosted editions. Sharing a link does not share your personal progress.

## Automatic tracking

The website also offers browser-only after-match recognition. Click **Tracker > Start tracking**, select the Call of Duty game window, and leave the tab open. Desktop Edge or Chrome over HTTPS is recommended. Permission is requested every session; no Windows installation is needed.

**Catch up existing progress:** while sharing, open each weapon's **Camo Select / Progression** overview and leave it visible for about 5–10 seconds. The tracker reads the weapon and labelled category totals after a small layout probe, then applies two stable readings automatically. Military totals mark the sequential prefix; fully completed Special/Prestige groups mark their camos. Partial Special/Prestige and completionist totals are shown as observations without guessing individual unlocks. Repeat for the next weapon; no screenshots or review clicks are needed. An unchanged reading preserves subsequent manual corrections.

The low-impact mode requests one capture frame per second and probes a small banner region every two seconds. Potential results screens trigger cropped OCR in one local worker. After about 15 seconds without a confirmed results banner, the worker unloads to save memory; it wakes on the next candidate. Confirmed Military rewards complete their sequential prefix; named camo rewards must match that weapon's catalogue. XP, attachment cards and level/unlock totals never imply camo completion. No screenshots, raw readings or video are saved or uploaded. Only recognised unlock records are saved in your browser.

Start before a match so the local recognition engine is ready. First start downloads pinned OCR assets from this website; later starts use browser caching. Leave the results cards visible for two checks. Fast animations, poor capture quality, background throttling and unsupported layouts can cause missed readings. Initial support targets the supplied 16:9 results and progression layouts. Partial challenge counters are not read by the browser mode; manual controls remain available. Stop tracking releases sharing and the OCR worker. Screen sharing and OCR still use resources; performance on a low-end gaming PC needs real-match testing.

The existing optional Windows companion is included in the source download. Extract the repository ZIP and double-click Open-Automatic-Tracker.cmd. It opens a separate local interface and uses built-in Windows OCR for camo menus. Click Tracker > Start tracker to enable it. The hosted website does not connect to the companion. See [local tracker instructions](LOCAL-TRACKER.md) for that mode's capture behavior and limitations.

## Develop and deploy

The website lives in web/. Open web/index.html directly or serve that folder with any static HTTP server. There are no npm dependencies or build steps. GitHub Actions deploys only web/ to GitHub Pages when main changes.

Build-Single-HTML.py produces a standalone manual HTML file with embedded graphics. Build-Web-Package.py produces a clean ZIP with the optional companion. Neither public builder imports personal progress.

Browser OCR uses vendored Tesseract.js 6.0.1, Tesseract.js-core 6.0.0 and pinned tessdata_fast English data. Their licences, source URLs and SHA-256 checksums are in web/vendor/ocr/. Run tools/vendor-ocr.py to reproduce those assets. No runtime CDN is used. Parser checks run with `node tests/reward-parser.cjs`.

## Catalogue and artwork

Includes 33 weapons, 462 base/completionist entries, editable objectives, Prestige presets and official reference sheets. Confidence labels identify uncertain or conflicting requirements. Some reference images are sheets rather than individual camo previews; three weapon images are labelled placeholders.

Per-entry sources appear in the interface. See [catalogue source notes](LOCAL-TRACKER.md#catalogue-and-source-confidence). Game names and reference artwork belong to Activision and their respective owners. This is an unofficial fan tool with no account integration or game-memory access. Reference artwork is not offered under an open-source artwork licence.
