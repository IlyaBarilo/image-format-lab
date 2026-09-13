"""Build the pinned JPEG decoder without fetching dependencies.
Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

package = Path(__file__).resolve().parent
lock = json.loads((package / 'sources.lock.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--cmake', default='cmake')
parser.add_argument('--ninja', default='ninja')
parser.add_argument('--jobs', type=int, default=4)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.cmake = shutil.which(args.cmake) or args.cmake
args.ninja = shutil.which(args.ninja) or args.ninja
work, sdk, output = args.work.resolve(), args.sdk.resolve(), args.output.resolve()
if work == package or work in package.parents:
    raise SystemExit('Build directory must not contain the source package')
work.mkdir(parents=True, exist_ok=True)
emroot = sdk / 'upstream/emscripten'
env = dict(os.environ, EMSDK=str(sdk), EMSDK_PYTHON=sys.executable,
           EM_CONFIG=str(sdk / '.emscripten'), EM_CACHE=str(work / 'emscripten-cache'), SOURCE_DATE_EPOCH='1782840343')
env['PATH'] = os.pathsep.join([str(Path(sys.executable).parent), str(emroot),
    str(Path(args.ninja).resolve().parent), str(Path(args.cmake).resolve().parent), env['PATH']])

def run(command):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), env=env, check=True)

version = subprocess.check_output([sys.executable, str(emroot / 'emcc.py'), '--version'], env=env, text=True)
if lock['toolchain']['emscripten'] not in version.splitlines()[0]:
    raise SystemExit('Expected Emscripten ' + lock['toolchain']['emscripten'])
info = lock['library']
archive = package / 'upstream' / info['archive']
if hashlib.sha256(archive.read_bytes()).hexdigest() != info['sha256']:
    raise SystemExit('JPEG source archive integrity check failed')
prefix = 'libjpeg-turbo-' + info['version']
with tarfile.open(archive) as source:
    for member in source.getmembers():
        target = (work / member.name).resolve()
        if not target.is_relative_to(work) or not (member.name == prefix or member.name.startswith(prefix + '/')):
            raise SystemExit('Unsafe source path: ' + member.name)
    source.extractall(work, filter='data')
build = work / 'build'
run([args.cmake, '-S', work / prefix, '-B', build, '-G', 'Ninja',
     '-DCMAKE_MAKE_PROGRAM=' + str(Path(args.ninja).resolve()),
     '-DCMAKE_TOOLCHAIN_FILE=' + str(emroot / 'cmake/Modules/Platform/Emscripten.cmake'),
     '-DCMAKE_BUILD_TYPE=Release', '-DENABLE_SHARED=OFF', '-DENABLE_STATIC=ON',
     '-DWITH_SIMD=OFF', '-DWITH_TURBOJPEG=OFF', '-DWITH_TOOLS=OFF', '-DWITH_TESTS=OFF',
     '-DCMAKE_C_FLAGS=-ffile-prefix-map=' + work.as_posix() + '=.'])
run([args.cmake, '--build', build, '--target', 'jpeg-static', '--clean-first', '--parallel', args.jobs])
exports = ['malloc', 'free', 'viewer_jpeg_decode', 'viewer_jpeg_clear', 'viewer_jpeg_error',
           'viewer_jpeg_version', 'viewer_jpeg_width', 'viewer_jpeg_height', 'viewer_jpeg_components',
           'viewer_jpeg_precision', 'viewer_jpeg_lossless', 'viewer_jpeg_adobe', 'viewer_jpeg_pixels', 'viewer_jpeg_bytes']
output.parent.mkdir(parents=True, exist_ok=True)
run([sys.executable, emroot / 'emcc.py', package / 'bridge.c', build / 'libjpeg.a',
     '-I' + str(work / prefix / 'src'), '-I' + str(build), '-O3', '--no-entry',
     '-sMODULARIZE=1', '-sEXPORT_NAME=ViewerJpegModule', '-sSINGLE_FILE=1', '-sSINGLE_FILE_BINARY_ENCODE=0',
     '-sENVIRONMENT=worker,node', '-sALLOW_MEMORY_GROWTH=1', '-sMALLOC=emmalloc', '-sEMIT_EMSCRIPTEN_LICENSE=1',
     '-sINITIAL_MEMORY=16777216', '-sMAXIMUM_MEMORY=1073741824', '-sSTACK_SIZE=1048576',
     '-sFILESYSTEM=0', '-sDYNAMIC_EXECUTION=0', '-sWASM_ASYNC_COMPILATION=1',
     '-ffile-prefix-map=' + package.as_posix() + '=jpeg-sources', '-Wl,-Map=' + str(output.with_suffix('.map')),
     '-sEXPORTED_FUNCTIONS=' + json.dumps(['_' + name for name in exports]),
     '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(['HEAPU8', 'UTF8ToString']), '-o', output])
print(json.dumps({'file': output.name, 'bytes': output.stat().st_size,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
