"""Collect exact linked-source copyright headers; no recursive file inventory.
Copyright (c) 2026 Ilya Barilo. MIT.
"""
import argparse
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--map', type=Path, required=True)
args = parser.parse_args()
vendor = Path(__file__).resolve().parent.parent / 'vendor'
mapping = args.map.read_text(encoding='utf-8')
source = args.work / 'libjpeg-turbo-3.2.0/src'
em = args.sdk / 'upstream/emscripten'
paths = []
for name in sorted(set(re.findall(r'libjpeg\.a\(([^()]+)\.c\.o\)', mapping))):
    base = re.sub(r'-(8|12|16)$', '', name)
    paths.append((source / (base + '.c'), 'libjpeg-turbo-3.2.0/src/' + base + '.c'))
runtime = ['system/lib/emmalloc.c', 'system/lib/libc/emscripten_memcpy.c', 'system/lib/libc/emscripten_memset.c']
for name in sorted(set(re.findall(r'libc\.a\(([^()]+)\.o\)', mapping))):
    for section in ['math', 'stdio', 'string', 'stdlib']:
        candidate = 'system/lib/libc/musl/src/' + section + '/' + name + '.c'
        if (em / candidate).is_file():
            runtime.append(candidate)
paths += [(em / name, 'Emscripten-6.0.9/' + name) for name in runtime]
texts = ['JPEG linked-source notices, collected from libjpeg-turbo 3.2.0 and Emscripten 6.0.9.\n'
         'Full license texts: libjpeg-turbo-README.ijg, libjpeg-turbo-LICENSE, Emscripten-LICENSE,\n'
         'Emscripten-AUTHORS, musl-COPYRIGHT, compiler-rt-LICENSE and compiler-rt-CREDITS.\n']
seen = set()
for path, label in paths:
    if label in seen:
        continue
    seen.add(label)
    text = path.read_text(encoding='utf-8')
    comment = re.match(r'\s*((?:(?:/\*[\s\S]*?\*/|//[^\n]*\n)\s*)+)', text)
    if comment:
        texts.append(label + '\n' + comment[1].strip() + '\n')
(vendor/'JPEG-RUNTIME-NOTICE').write_bytes('\n'.join(texts).encode('utf-8'))
print('Collected', len(seen), 'linked source headers.')
