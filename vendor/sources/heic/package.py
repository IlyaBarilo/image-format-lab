"""Package this source directory using an explicit file list; never walk directories.
Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((root / 'package-files.json').read_text(encoding='utf-8'))
lock = json.loads((root / 'sources.lock.json').read_text(encoding='utf-8'))
files = manifest['files']
if len(set(files)) != len(files):
    raise SystemExit('Duplicate source-package path')
for info in (lock[name] for name in ('libheif', 'libde265', 'kvazaar', 'aom')):
    file = root / 'upstream' / info['archive']
    if hashlib.sha256(file.read_bytes()).hexdigest() != info['sha256']:
        raise SystemExit('Update sources.lock.json after modifying a source archive')
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        if name.startswith('/') or '\\' in name or ':' in name or '..' in name.split('/'):
            raise SystemExit('Invalid source-package path')
        source = (root / name).resolve()
        if not source.is_relative_to(root) or source == args.output.resolve():
            raise SystemExit('Source-package path escapes its root')
        entry = zipfile.ZipInfo('heic-sources/' + name, (1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, source.read_bytes(), compresslevel=9)
print(args.output.name, args.output.stat().st_size, hashlib.sha256(args.output.read_bytes()).hexdigest())
