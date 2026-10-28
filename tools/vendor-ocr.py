"""Fetch pinned public OCR dependencies; never reads tracker/user data."""
from pathlib import Path
import gzip, hashlib, io, json, tarfile, urllib.request

root = Path(__file__).resolve().parents[1] / 'web/vendor/ocr'
root.mkdir(parents=True, exist_ok=True)
checks = {}

def fetch(url):
    return urllib.request.urlopen(url, timeout=60).read()

def write(name, data, source):
    dest = root / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    checks[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'source': source}

for package, version, names in [
    ('tesseract.js', '6.0.1', ['dist/tesseract.min.js', 'dist/worker.min.js', 'LICENSE.md',
                             'dist/tesseract.min.js.LICENSE.txt', 'dist/worker.min.js.LICENSE.txt']),
    ('tesseract.js-core', '6.0.0', ['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm',
                                 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm', 'LICENSE']),
]:
    url = f'https://registry.npmjs.org/{package}/-/{package}-{version}.tgz'
    with tarfile.open(fileobj=io.BytesIO(fetch(url)), mode='r:gz') as archive:
        for name in names:
            member = archive.extractfile('package/' + name)
            dest = ('core/' + name if package.endswith('-core') else name.removeprefix('dist/'))
            write(dest, member.read(), url)

sha = '87416418657359cb625c412a48b6e1d6d41c29bd'
url = f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{sha}/eng.traineddata'
write('lang/eng.traineddata.gz', gzip.compress(fetch(url), mtime=0), url)
url = f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{sha}/LICENSE'
write('lang/LICENSE', fetch(url), url)
(root / 'checksums.json').write_text(json.dumps(checks, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files': len(checks), 'bytes': sum((root/n).stat().st_size for n in checks)}))
