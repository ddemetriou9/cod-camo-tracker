# COD Camo Tracker — MW4 Fieldnotes

A buildless HTML/JavaScript camo planner with weapon checklists, requirements, reference graphics and up to six next-match goals.

## Use the website

Open https://ddemetriou9.github.io/cod-camo-tracker/ . No account, installation or local server is required for manual tracking.

Click a Military square to complete it and every earlier Military square. Special and finish squares toggle individually. Hover a camo for its requirement and Track button. Open a weapon for its full checklist and editable counters.

Progress is stored in this browser's localStorage; pictures you deliberately add use IndexedDB. No progress is uploaded. Clearing site data removes it. Use Export plan for backups and Import to move progress between browsers, devices, or the local and hosted editions. Sharing a link does not share your personal progress.

## Automatic tracking

This published version supports manual tracking. Browser-only detection of after-match camo reward cards is planned and is not enabled in this version.

The existing optional Windows companion is included in the source download. Extract the repository ZIP and double-click Open-Automatic-Tracker.cmd. It opens a separate local interface and uses built-in Windows OCR. Click Tracker > Start tracker to enable it. The hosted website does not connect to the companion. See [local tracker instructions](LOCAL-TRACKER.md) for capture behavior and limitations.

## Develop and deploy

The website lives in web/. Open web/index.html directly or serve that folder with any static HTTP server. There are no npm dependencies or build steps. GitHub Actions deploys only web/ to GitHub Pages when main changes.

Build-Single-HTML.py produces a standalone manual HTML file with embedded graphics. Build-Web-Package.py produces a clean ZIP with the optional companion. Neither public builder imports personal progress.

## Catalogue and artwork

Includes 33 weapons, 462 base/completionist entries, editable objectives, Prestige presets and official reference sheets. Confidence labels identify uncertain or conflicting requirements. Some reference images are sheets rather than individual camo previews; three weapon images are labelled placeholders.

Per-entry sources appear in the interface. See [catalogue source notes](LOCAL-TRACKER.md#catalogue-and-source-confidence). Game names and reference artwork belong to Activision and their respective owners. This is an unofficial fan tool with no account integration or game-memory access. Reference artwork is not offered under an open-source artwork licence.
