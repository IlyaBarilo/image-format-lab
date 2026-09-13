"""Select build sources from the verified official libjpeg-turbo archive.
Copyright (c) 2026 Ilya Barilo. MIT. Never walks the workspace.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('upstream', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
package = root / 'vendor/sources/jpeg'
lock = json.loads((package / 'sources.lock.json').read_text(encoding='utf-8'))
info = lock['library']
expected = info.get('upstreamSha256', info['sha256'])
if hashlib.sha256(args.upstream.read_bytes()).hexdigest() != expected:
    raise SystemExit('Upstream JPEG source integrity check failed')
prefix = 'libjpeg-turbo-' + info['version']
contents = []
with tarfile.open(args.upstream) as archive:
    for member in archive.getmembers():
        parts = PurePosixPath(member.name).parts
        if not parts or parts[0] != prefix or '..' in parts or '\\' in member.name:
            raise SystemExit('Unsafe source member')
        if not member.isfile() or len(parts) < 2:
            continue
        if len(parts) > 2 and parts[1] not in {'src', 'cmakescripts', 'test', 'release'}:
            continue
        if parts[1] == 'src' and len(parts) > 3 and parts[2] not in {'wrapper'}:
            continue
        if parts[1] == 'test' and not member.name.endswith('.in'):
            continue
        if PurePosixPath(member.name).suffix.lower() in {'.jpg','.jpeg','.png','.gif','.svg','.ico','.bmp','.pdf'}:
            continue
        contents.append((member.name, member.mode, archive.extractfile(member).read()))
tar = io.BytesIO()
with tarfile.open(fileobj=tar, mode='w', format=tarfile.USTAR_FORMAT) as output:
    for name, mode, data in sorted(contents):
        member = tarfile.TarInfo(name)
        member.mode = 0o755 if mode & 0o111 else 0o644
        member.size = len(data)
        output.addfile(member, io.BytesIO(data))
data = gzip.compress(tar.getvalue(), compresslevel=9, mtime=0)
info.update(upstreamSha256=expected, archive=prefix+'-sources.tar.gz', sha256=hashlib.sha256(data).hexdigest(), files=len(contents),
            selection='Unmodified file bytes: root docs, src and wrappers, cmakescripts, release and test .in templates. No test images, SIMD, JNA, spng or md5 sources.')
(package/'upstream'/info['archive']).write_bytes(data)
(package/'sources.lock.json').write_text(json.dumps(lock,indent=2)+'\n',encoding='utf-8')
print(len(contents), len(data), info['sha256'])
