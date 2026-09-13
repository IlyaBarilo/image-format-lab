"""Collect HEIC runtime notices from the exact SDK and linked-object map.
Copyright (c) 2026 Ilya Barilo. MIT; see ../LICENSE.
"""
import argparse
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, required=True)
parser.add_argument('--map', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
vendor = root / 'vendor'
em = args.sdk.resolve() / 'upstream/emscripten'
copies = {
    'Emscripten-LICENSE': 'LICENSE', 'Emscripten-AUTHORS': 'AUTHORS',
    'musl-COPYRIGHT': 'system/lib/libc/musl/COPYRIGHT',
    'libcxx-LICENSE': 'system/lib/libcxx/LICENSE.TXT',
    'libcxxabi-LICENSE': 'system/lib/libcxxabi/LICENSE.TXT',
    'compiler-rt-LICENSE': 'system/lib/compiler-rt/LICENSE.TXT',
    'compiler-rt-CREDITS': 'system/lib/compiler-rt/CREDITS.TXT',
    'llvm-libc-LICENSE': 'system/lib/llvm-libc/LICENSE.TXT',
}
for name, source in copies.items():
    shutil.copyfile(em / source, vendor / name)
for name, version in [('libheif', '1.23.4'), ('libde265', '1.1.2')]:
    shutil.copyfile(args.work / (name + '-' + version) / 'COPYING', vendor / (name + '-COPYING'))

objects = sorted(set(re.findall(r'libc\.a\(([^()]+)\.o\)', args.map.read_text(encoding='utf-8'))))
notices = ['Runtime notices from Emscripten 6.0.9 used by HEIC.\n'
           'Full license texts and authors are supplied as separate files.\n'
           'The following are verbatim leading comments from linked math/runtime files.\n']
paths = ['system/lib/emmalloc.c']
paths += ['system/lib/libc/musl/src/math/' + name + '.c' for name in objects
          if (em / ('system/lib/libc/musl/src/math/' + name + '.c')).is_file()]
paths += ['system/lib/libc/emscripten_memcpy.c', 'system/lib/libc/emscripten_memset.c']
for name in paths:
    text = (em / name).read_text(encoding='utf-8')
    comments = re.match(r'\s*((?:(?:/\*[\s\S]*?\*/|//[^\n]*\n)\s*)+)', text)
    if comments:
        notices.append(name + '\n' + comments[1].strip() + '\n')
md5 = args.work / 'libde265-1.1.2/libde265/md5.cc'
notices.append('libde265-1.1.2/libde265/md5.cc\n' + md5.read_text(encoding='utf-8').split('*/', 1)[0] + '*/\n')
(vendor / 'HEIC-RUNTIME-NOTICE').write_text('\n'.join(notices), encoding='utf-8')
kvazaar = args.work / 'kvazaar-2.3.2'
for name in ('LICENSE', 'CREDITS'):
    shutil.copyfile(kvazaar / name, vendor / ('kvazaar-' + name))
kvazaar_notices = []
for name in ('src/extras/libmd5.c', 'src/extras/libmd5.h', 'src/sei.h'):
    source = (kvazaar / name).read_text(encoding='utf-8')
    comment = re.search(r'/\*[\s\S]*?\*/', source)[0]
    kvazaar_notices.append(name + '\n' + comment + '\n')
(vendor / 'kvazaar-NOTICE').write_text('Kvazaar 2.3.2 HEVC encoder, BSD-3-Clause.\n'
    'https://github.com/ultravideo/kvazaar/tree/v2.3.2\n'
    'Unmodified library source bytes; see sources/heic/sources.lock.json.\n'
    'LICENSE and CREDITS are supplied verbatim. Additional source/header notices:\n\n'
    + '\n'.join(kvazaar_notices), encoding='utf-8')
print('Collected exact SDK license texts and linked runtime notices.')
