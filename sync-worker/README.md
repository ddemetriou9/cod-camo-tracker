# Sync server

Optional cross-device sync for the tracker (`web/sync.js`). A Cloudflare Worker with one D1 table, live at
https://mw4-sync.cod-camo-tracker.workers.dev on the 0xreddevil@gmail.com Cloudflare account (free plan).

- A **sync code** (`MW4-XXXX-XXXX-XXXX-XXXX`) reads and writes one tracker. Only its SHA-256 hash is stored.
- A **share link** (`#view/<id>`) reads camo progress only; goals and notes are left out. It can be replaced.
- Writes carry the revision they were based on; a stale write gets the newer copy back (409) for the browser to merge.

Commands (run here):

```bash
npx wrangler@4.86.0 d1 execute mw4-sync --local --file=schema.sql
npx wrangler@4.86.0 dev --port 8787 --ip 127.0.0.1
npx wrangler@4.86.0 deploy
```

To test the site against a local server, run `localStorage.setItem('mw4.sync.api','http://127.0.0.1:8787')` in the page's console.
