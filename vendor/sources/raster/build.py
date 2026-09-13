"""Build the pinned BMP/TIFF libraries without network access.
Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, required=True)
parser.add_argument('--cmake', type=Path, required=True)
parser.add_argument('--ninja', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent
work, output, sdk = args.work.resolve(), args.output.resolve(), args.sdk.resolve()
work.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)
em = sdk / 'upstream/emscripten'
env = dict(os.environ, EMSDK=str(sdk), EMSDK_PYTHON=sys.executable,
           EM_CONFIG=str(sdk / '.emscripten'), SOURCE_DATE_EPOCH='0')
env.setdefault('EM_CACHE', str(work / 'em-cache'))
env['PATH'] = os.pathsep.join([str(Path(sys.executable).parent), str(em),
                             str(args.ninja.resolve().parent), env['PATH']])

def run(command):
    subprocess.run(list(map(str, command)), env=env, check=True)

lock = json.loads((source / 'sources.lock.json').read_text(encoding='utf-8'))
version = subprocess.check_output([sys.executable, str(em / 'emcc.py'), '--version'], env=env, text=True)
if not re.search(r'\b' + re.escape(lock['emscripten']) + r'\b', version):
    raise ValueError('Use the Emscripten version in sources.lock.json')
roots = {}
for item in lock['libraries']:
    archive = source / item['archive']
    if hashlib.sha256(archive.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError('Source checksum mismatch: ' + item['archive'])
    with tarfile.open(archive) as package:
        members = package.getmembers()
        for member in members:
            target = (work / member.name).resolve()
            if not target.is_relative_to(work) or not member.isfile():
                raise ValueError('Invalid source archive member')
        package.extractall(work, members=members, filter='data')
    roots[item['name']] = work / item['root']
# ICO stores a DIB without BMP's 14-byte file header. Keep the upstream archive
# unchanged and apply this bounded-header correction only to the build copy.
nsbmp_file = roots['libnsbmp'] / 'src/libnsbmp.c'
nsbmp_text = nsbmp_file.read_text(encoding='utf-8')
for before, after in [
    ('bmp->buffer_size < (BMP_FILE_HEADER_SIZE + BITMAPCOREHEADER)',
     'bmp->buffer_size < ((bmp->ico ? 0 : BMP_FILE_HEADER_SIZE) + BITMAPCOREHEADER)'),
    ('(bmp->buffer_size - BMP_FILE_HEADER_SIZE) < header_size',
     '(bmp->buffer_size - (bmp->ico ? 0 : BMP_FILE_HEADER_SIZE)) < header_size'),
    ('bmp->buffer_size < (14 + header_size)',
     'bmp->buffer_size < ((bmp->ico ? 0 : 14) + header_size)')]:
    if nsbmp_text.count(before) != 1:
        raise ValueError('Unexpected libnsbmp header check')
    nsbmp_text = nsbmp_text.replace(before, after)
nsbmp_file.write_text(nsbmp_text, encoding='utf-8', newline='\n')
cmake, ninja = args.cmake.resolve(), args.ninja.resolve()
common = ['-G', 'Ninja', '-DCMAKE_MAKE_PROGRAM=' + str(ninja),
          '-DCMAKE_TOOLCHAIN_FILE=' + str(em / 'cmake/Modules/Platform/Emscripten.cmake'),
          '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=-ffile-prefix-map=' + work.as_posix() + '=.']
run([cmake, '-S', roots['zlib'], '-B', work / 'build-zlib', *common,
     '-DZLIB_BUILD_TESTING=OFF', '-DZLIB_BUILD_SHARED=OFF', '-DZLIB_INSTALL=OFF'])
run([cmake, '--build', work / 'build-zlib', '--parallel', '4'])
run([cmake, '-S', roots['libtiff'], '-B', work / 'build-tiff', *common,
     '-DBUILD_SHARED_LIBS=OFF', '-Dtiff-tools=OFF', '-Dtiff-tests=OFF',
     '-Dtiff-contrib=OFF', '-Dtiff-docs=OFF', '-Dtiff-install=OFF', '-Dtiff-cxx=OFF',
     '-Djpeg=OFF', '-Dold-jpeg=OFF', '-Dlerc=OFF', '-Dlzma=OFF', '-Dzstd=OFF',
     '-Dwebp=OFF', '-Djbig=OFF', '-DZLIB_LIBRARY=' + str(work / 'build-zlib/libz.a'),
     '-DZLIB_INCLUDE_DIR=' + str(roots['zlib'])])
run([cmake, '--build', work / 'build-tiff', '--target', 'tiff', '--parallel', '4'])
flags = ['-O3', '--no-entry', '-sMODULARIZE=1', '-sSINGLE_FILE=1',
         '-sSINGLE_FILE_BINARY_ENCODE=0', '-sENVIRONMENT=worker,node',
         '-sALLOW_MEMORY_GROWTH=1', '-sMALLOC=emmalloc', '-sEMIT_EMSCRIPTEN_LICENSE=1',
         '-sINITIAL_MEMORY=16777216', '-sMAXIMUM_MEMORY=1073741824',
         '-sSTACK_SIZE=1048576', '-sFILESYSTEM=0', '-sDYNAMIC_EXECUTION=0',
         '-ffile-prefix-map=' + source.as_posix() + '=bridge',
         '-ffile-prefix-map=' + work.as_posix() + '=.']
for name, factory, inputs, exports, runtime in [
    ('bmp-decoder', 'ViewerBmpModule', [source / 'bmp-bridge.c', roots['libnsbmp'] / 'src/libnsbmp.c',
      '-I' + str(roots['libnsbmp'] / 'include'), '-I' + str(roots['libnsbmp'] / 'src')],
     ['decode', 'clear', 'pixels', 'width', 'height'], ['HEAPU8']),
    ('tiff-codec', 'ViewerTiffModule', [source / 'tiff-bridge.c', work / 'build-tiff/libtiff/libtiff.a',
      work / 'build-zlib/libz.a', '-I' + str(roots['libtiff'] / 'libtiff'), '-I' + str(work / 'build-tiff/libtiff')],
     ['decode', 'encode', 'clear', 'pixels', 'bytes', 'width', 'height', 'pages', 'error'], ['HEAPU8', 'UTF8ToString'])]:
    prefix = 'bmp' if name == 'bmp-decoder' else 'tiff'
    symbols = ['_malloc', '_free'] + ['_viewer_' + prefix + '_' + symbol for symbol in exports]
    run([sys.executable, em / 'emcc.py', *inputs, *flags, '-sEXPORT_NAME=' + factory,
         '-sEXPORTED_FUNCTIONS=' + json.dumps(symbols), '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(runtime),
         '-Wl,-Map=' + str(work / (name + '.map')), '-o', output / (name + '.js')])

# Preserve exact copyright headers from linked library/runtime sources.
headers = ['BMP/TIFF linked-source notices. Full texts: libnsbmp-LICENSE, libtiff-LICENSE,\n'
           'zlib-LICENSE, Emscripten-LICENSE, Emscripten-AUTHORS, musl-COPYRIGHT,\n'
           'compiler-rt-LICENSE, compiler-rt-CREDITS and llvm-libc-LICENSE.\n']
mapping = '\n'.join((work / (name + '.map')).read_text() for name in ['bmp-decoder', 'tiff-codec'])
paths = [(roots['libnsbmp'] / 'src/libnsbmp.c', 'libnsbmp/src/libnsbmp.c')]
for name in sorted(set(re.findall(r'libtiff\.a\(([^()]+)\.c\.o\)', mapping))):
    paths.append((roots['libtiff'] / 'libtiff' / (name + '.c'), 'libtiff/' + name + '.c'))
for name in sorted(set(re.findall(r'libz\.a\(([^()]+)\.c\.o\)', mapping))):
    paths.append((roots['zlib'] / (name + '.c'), 'zlib/' + name + '.c'))
runtime = ['system/lib/emmalloc.c', 'system/lib/libc/emscripten_memcpy.c', 'system/lib/libc/emscripten_memset.c']
for name in sorted(set(re.findall(r'libc\.a\(([^()]+)\.o\)', mapping))):
    for section in ['math', 'stdio', 'string', 'stdlib', 'internal', 'ctype', 'locale', 'errno']:
        path = 'system/lib/libc/musl/src/' + section + '/' + name + '.c'
        if (em / path).is_file():
            runtime.append(path)
paths += [(em / path, 'Emscripten-6.0.9/' + path) for path in runtime]
for path, label in paths:
    content = path.read_text(encoding='utf-8')
    comment = re.match(r'\s*((?:(?:/\*[\s\S]*?\*/|//[^\n]*\n)\s*)+)', content)
    if comment:
        headers.append(label + '\n' + comment[1].strip() + '\n')
(output / 'RASTER-RUNTIME-NOTICE').write_text('\n'.join(headers), encoding='utf-8')
print('Built bmp-decoder.js, tiff-codec.js and RASTER-RUNTIME-NOTICE')
