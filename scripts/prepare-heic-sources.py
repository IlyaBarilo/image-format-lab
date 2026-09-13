"""Prepare build-source archives from two verified upstream release archives.
Explicit archive inputs and member allowlists; no filesystem walks.
Copyright (c) 2026 Ilya Barilo. MIT; see ../LICENSE.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

root = Path(__file__).resolve().parent.parent
package = root / 'vendor/sources/heic'
parser = argparse.ArgumentParser()
parser.add_argument('--downloads', type=Path, required=True)
args = parser.parse_args()
lock = json.loads((package / 'sources.lock.json').read_text(encoding='utf-8'))
allow = {'libheif': {'libheif', 'cmake', 'heifio', 'gnome', 'extra', 'scripts'},
         'libde265': {'libde265', 'cmake', 'extra'}}
outdir = package / 'upstream'
outdir.mkdir(exist_ok=True)
for name in allow:
    info = lock[name]
    prefix = name + '-' + info['version']
    original = args.downloads / (prefix + '.tar.gz')
    if hashlib.sha256(original.read_bytes()).hexdigest() != info['upstreamSha256']:
        raise SystemExit('Upstream SHA-256 mismatch: ' + name)
    contents = []
    with tarfile.open(original) as upstream:
        for member in upstream.getmembers():
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != prefix or '..' in parts or '\\' in member.name:
                raise SystemExit('Unexpected source archive path')
            if not member.isfile() or len(parts) < 2:
                continue
            # Root-level upstream artwork is not part of the decoder sources.
            if PurePosixPath(member.name).suffix.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.heic', '.heif', '.avif'}:
                continue
            if len(parts) > 2 and parts[1] not in allow[name]:
                continue
            contents.append((member.name, member.mode, upstream.extractfile(member).read()))
    tar_bytes = io.BytesIO()
    with tarfile.open(fileobj=tar_bytes, mode='w', format=tarfile.USTAR_FORMAT) as output:
        for member_name, mode, data in sorted(contents):
            entry = tarfile.TarInfo(member_name)
            entry.size = len(data)
            entry.mode = 0o755 if mode & 0o111 else 0o644
            output.addfile(entry, io.BytesIO(data))
    info['archive'] = prefix + '-sources.tar.gz'
    compressed = gzip.compress(tar_bytes.getvalue(), compresslevel=9, mtime=0)
    (outdir / info['archive']).write_bytes(compressed)
    info['sha256'] = hashlib.sha256(compressed).hexdigest()
    info['files'] = len(contents)
    info['selection'] = {'rootFiles': True, 'directories': sorted(allow[name]),
                         'note': 'Unmodified file bytes; test images, examples and unrelated optional dependencies omitted.'}
    print(name, len(contents), len(compressed), info['sha256'])
(package / 'sources.lock.json').write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
(package / 'PROJECT-LICENSE').write_bytes((root / 'LICENSE').read_bytes())
