"""Build the shareable manual edition. Never reads personal progress or uploads."""
from pathlib import Path
import base64
import json
import re

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
html = (WEB / 'index.html').read_text(encoding='utf-8-sig')
for name in ('reward-parser.js', 'browser-capture.js', 'browser-tracker-ui.js'):
    html = re.sub(r'<script src="' + re.escape(name) + r'(?:\?[^"]*)?"></script>', '', html)

# Inline the stylesheet, data and assets. Each picture is encoded just once;
# weapon thumbnails and library items refer to the same embedded data URL.
assets = {}
for image in sorted((WEB / 'assets').glob('*.webp')):
    assets['assets/' + image.name] = 'data:image/webp;base64,' + base64.b64encode(image.read_bytes()).decode('ascii')
for name in ('style.css', 'readability.css'):
    css = (WEB / name).read_text(encoding='utf-8-sig')
    html = html.replace(f'<link rel="stylesheet" href="{name}">', '<style>\n' + css + '\n</style>')

app = (WEB / 'app.js').read_text(encoding='utf-8-sig')
# Drop the Windows capture/API integration from this edition entirely.
app = app[:app.index('async function api(')] + app[app.index("$('#class-list').innerHTML="):]
app = re.sub(r"^let auto=.*\n|^let checkedNativeMigration=.*\n|^const token=.*\n|^const companion=.*\n", '', app, flags=re.M)
app = app.replace(' if(d.autoAction)automationAction(d.autoAction);\n', '').replace(' if(d.applyReading)applyReading(d.applyReading);\n', '')
app = app.replace(' if(d.applyCategory)applyCategory(d.applyCategory);\n', '')
app = app.replace('if(companion){refreshAuto();setInterval(refreshAuto,4000);}', '')
app = app.replace('Counts and notes are editable. Screenshots are optional.', 'Counts and notes are editable. Everything is managed by you.')
app = app.replace('Your plan works without screenshots.', 'Your plan stays in this browser.')
app = app.replace('Automatic capture has not been started.', 'Progress is saved in this browser.')
app = app.replace('Share the clean MW4-HTML-Tracker.zip to let a friend start fresh.', 'Share this HTML file to let a friend start fresh. It already includes the interface, catalogue and official graphics.')
app = app.replace('Reference images stay in this browser', 'Reference images stay in this browser')
assert 'fetch(' not in app and 'companion' not in app and 'automationAction' not in app

catalog = (WEB / 'catalog.js').read_text(encoding='utf-8-sig')
payload = 'window.NATIVE_MIGRATION=null;\n' + catalog + '\n' + '(()=>{const images=' + json.dumps(assets, separators=(',', ':')) + ';for(const item of window.CAMO_CATALOG.images){item.path=images[item.path];}for(const weapon of window.CAMO_CATALOG.weapons){if(weapon.image)weapon.image=images[weapon.image];}})();\n' + app
payload = re.sub(r'</script', r'<\\/script', payload, flags=re.I)
html = re.sub(r'<script src="catalog.js(?:\?[^\"]*)?"></script><script src="migration.js"></script><script src="app.js(?:\?[^\"]*)?"></script>', lambda _: '<script>\n' + payload + '\n</script>', html)
html = re.sub(r'<button id="automation".*?</button>', '<span class="manual-edition" style="align-self:center;font-size:12px;color:var(--muted)">Manual edition</span>', html)
html = html.replace('YOUR LOCAL CAMO COMPANION', 'MANUAL EDITION · ONE HTML FILE')
html = html.replace('No account. No analytics. Screenshots stay optional.', 'Manual tracking. All graphics included. Export a plan to back up your progress.')
html = html.replace('<title>MW4 Fieldnotes — Camo tracker</title>', '<title>MW4 Fieldnotes — Manual tracker</title>')
html = html.replace('Added images are stored deliberately in this browser, never captured automatically.', 'Images you add are stored only in this browser and are not embedded in the shared HTML file.')
assert '<script src=' not in html and '<link rel="stylesheet"' not in html
destination = ROOT / 'MW4-Manual-Tracker.html'
destination.write_text(html, encoding='utf-8')
print(json.dumps({'file': str(destination), 'bytes': destination.stat().st_size, 'embeddedImages': len(assets), 'personalDataIncluded': False, 'captureCodeIncluded': False}))
