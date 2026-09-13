"""Select pinned Kvazaar build sources, without upstream pictures or workspace walks.
Copyright (c) 2026 Ilya Barilo. MIT.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('archive', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
package = root / 'vendor/sources/heic'
expected = 'ddd0038696631ca5368d8e40efee36d2bbb805854b9b1dda8b12ea9b397ea951'
assert hashlib.sha256(args.archive.read_bytes()).hexdigest() == expected, 'Kvazaar upstream integrity mismatch'
files = []
with tarfile.open(args.archive) as source:
    for member in source.getmembers():
        parts = PurePosixPath(member.name).parts
        if not parts or parts[0] != 'kvazaar-2.3.2' or '..' in parts or '\\' in member.name:
            raise ValueError('Unsafe source member')
        if not member.isfile() or len(parts) < 2:
            continue
        relative = '/'.join(parts[1:])
        if relative not in {'CMakeLists.txt','LICENSE','CREDITS','README.md','doc/kvazaar.1'} and not relative.startswith('src/'):
            continue
        if relative.startswith('src/threadwrapper/'):
            continue # Windows-only replacement pthread library; not part of WASM.
        if PurePosixPath(relative).suffix.lower() not in {'','.txt','.md','.1','.c','.h','.cpp','.in'}:
            continue
        files.append((member.name, source.extractfile(member).read()))
out = io.BytesIO()
with tarfile.open(fileobj=out, mode='w', format=tarfile.USTAR_FORMAT) as archive:
    for name, data in sorted(files):
        member = tarfile.TarInfo(name); member.mode = 0o644; member.size = len(data)
        archive.addfile(member, io.BytesIO(data))
data = gzip.compress(out.getvalue(), compresslevel=9, mtime=0)
archive_name = 'kvazaar-2.3.2-sources.tar.gz'
(package/'upstream'/archive_name).write_bytes(data)
lock_path = package/'sources.lock.json'
lock = json.loads(lock_path.read_text(encoding='utf-8'))
lock['kvazaar'] = {'version':'2.3.2', 'commit':'6040962bed5cc68c5ad01234c38c08b8b2822068',
    'url':'https://github.com/ultravideo/kvazaar/archive/refs/tags/v2.3.2.tar.gz',
    'upstreamSha256':expected, 'archive':archive_name, 'sha256':hashlib.sha256(data).hexdigest(),
    'files':len(files), 'selection':{'note':'Unmodified build/source bytes. No upstream images, test framework, Windows pthread replacement, or external crypto library.'}}
lock_path.write_text(json.dumps(lock,indent=2)+'\n',encoding='utf-8')
for name, content in files:
    if name.endswith('/LICENSE'): (root/'vendor/kvazaar-LICENSE').write_bytes(content)
    if name.endswith('/CREDITS'): (root/'vendor/kvazaar-CREDITS').write_bytes(content)
print(json.dumps(lock['kvazaar'],indent=2))
