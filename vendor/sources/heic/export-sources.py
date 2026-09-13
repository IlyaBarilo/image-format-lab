"""Save edited library sources into this package, using existing archive entries only.
Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--note', required=True, help='Describe your changes and their date')
parser.add_argument('--add', action='append', default=[], help='Explicit new path including libheif-VERSION/, libde265-VERSION/, kvazaar-VERSION/ or aom-VERSION/')
args = parser.parse_args()
work = args.work.resolve()
lock = json.loads((root / 'sources.lock.json').read_text(encoding='utf-8'))
prefixes = [name + '-' + lock[name]['version'] + '/' for name in ('libheif', 'libde265', 'kvazaar', 'aom')]
if any(not any(item.startswith(prefix) for prefix in prefixes) for item in args.add):
    raise SystemExit('--add must name a file under a pinned library source directory')
for name in ('libheif', 'libde265', 'kvazaar', 'aom'):
    info = lock[name]
    archive = root / 'upstream' / info['archive']
    prefix = name + '-' + info['version'] + '/'
    with tarfile.open(archive) as original:
        entries = {member.name: member.mode for member in original.getmembers() if member.isfile()}
    entries.update({item: 0o644 for item in args.add if item.startswith(prefix) and item not in entries})
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as target:
            for entry in sorted(entries):
                path = (work / entry).resolve()
                if not entry.startswith(prefix) or not path.is_relative_to(work / prefix):
                    raise SystemExit('Invalid source path: ' + entry)
                data = path.read_bytes()
                member = tarfile.TarInfo(entry)
                member.mode = entries[entry]
                member.size = len(data)
                target.addfile(member, io.BytesIO(data))
    archive.write_bytes(buffer.getvalue())
    info['sha256'] = hashlib.sha256(buffer.getvalue()).hexdigest()
    info['files'] = len(entries)
    info['modification'] = args.note
    info['selection'] = {'note': 'Local modifications; see modification and source file notices.'}
(root / 'sources.lock.json').write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
notice = root / 'licenses/HEIC-NOTICE'
text = notice.read_text(encoding='utf-8').replace('Library code is unmodified.', 'Local library modifications are described below and in sources.lock.json.')
notice.write_text(text + '\nLocal modifications: ' + args.note + '\n', encoding='utf-8')
print('Updated library archives and hashes. Review changed-file notices before redistribution.')
