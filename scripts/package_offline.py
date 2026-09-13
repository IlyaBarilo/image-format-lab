"""Optional offline handover: HTML, notices and separate source ZIPs; no walks."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'vendor/manifest.json').read_text(encoding='utf-8'))
html = (root / 'image-format-lab.html').read_text(encoding='utf-8')
payload = json.loads(re.search(r'id="embedded-codecs">(.*?)</script>', html, re.S)[1])
if payload['manifest'] != manifest or 'sourceArchives' in payload or 'sources' in payload:
    raise ValueError('HTML metadata is stale; run npm --prefix scripts run build')
entries = [('image-format-lab.html', 'image-format-lab.html'),
           ('docs/OFFLINE.md', 'README.md'), ('vendor/manifest.json', 'vendor/manifest.json')]
entries += [(name, name) for name in ('LICENSE', 'NOTICE.md', 'ASSETS.md',
                                     'docs/licenses/esbuild-LICENSE', 'docs/licenses/acorn-LICENSE')]
for package in payload['sourcePackages'].values():
    item = next(item for item in manifest['files'] if item['file'] == package['name'])
    if (item['bytes'], item['sha256']) != (package['bytes'], package['sha256']):
        raise ValueError('Source package metadata is stale')
    name = item['file']
    parts = PurePosixPath(name).parts
    if not parts or '\\' in name or ':' in name or name.startswith('/') or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError('Invalid vendor filename')
    relative = 'vendor/' + name
    if not (root / relative).resolve().is_relative_to((root / 'vendor').resolve()):
        raise ValueError('Vendor path outside explicit root')
    data = (root / relative).read_bytes()
    if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError('Vendor integrity check failed: ' + name)
    entries.append((relative, relative))
destination = root / 'dist/image-format-lab-offline.zip'
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for source, name in entries:
        entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, (root / source).read_bytes())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == {name for _, name in entries}
print(f'{destination.name}: {len(entries)} files, {destination.stat().st_size} bytes; CRC and allowlist OK')
