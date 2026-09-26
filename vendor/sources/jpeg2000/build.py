"""Rebuild the pinned OpenJPEG 2.5.4 single-file codec without network access."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tarfile

package = Path(__file__).resolve().parent
archive = package / 'upstream' / 'openjpeg-v2.5.4.tar.gz'
expected_sha256 = 'a695fbe19c0165f295a8531b1e4e855cd94d0875d2f88ec4b61080677e27188a'
p = argparse.ArgumentParser()
for name in ('sdk', 'work', 'cmake', 'ninja', 'output'):
    p.add_argument('--' + name, required=True, type=Path)
p.add_argument('--cache', type=Path)
p.add_argument('--jobs', type=int, default=4)
a = p.parse_args()
if a.jobs < 1 or a.jobs > 16:
    p.error('--jobs must be 1..16')
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_sha256:
    raise SystemExit('OpenJPEG source archive hash mismatch')

sdk = a.sdk.resolve()
em = sdk / 'upstream' / 'emscripten'
work = a.work.resolve()
source = work / 'openjpeg-2.5.4'
build = work / 'build'
temp = work / 'temp'
cache = (a.cache or work / 'emscripten-cache').resolve()
for directory in (work, temp, cache):
    directory.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    if any(not (m.name == 'openjpeg-2.5.4' or m.name.startswith('openjpeg-2.5.4/')) or m.issym() or m.islnk() for m in members):
        raise SystemExit('Unexpected path or link in OpenJPEG archive')
    tar.extractall(work, filter='data')

env = dict(os.environ, EMSDK=str(sdk), EMSDK_PYTHON=sys.executable,
           EM_CONFIG=str(sdk / '.emscripten'), EM_CACHE=str(cache),
           TMP=str(temp), TEMP=str(temp), TMPDIR=str(temp),
           SOURCE_DATE_EPOCH='1758067200', PYTHONPATH=str(a.cmake.resolve().parent.parent))
env['PATH'] = os.pathsep.join((str(Path(sys.executable).parent), str(em),
                               str(a.cmake.resolve().parent), str(a.ninja.resolve().parent), env['PATH']))

def run(*args):
    subprocess.run(list(map(str, args)), cwd=work, env=env, check=True)

run(a.cmake.resolve(), '-S', source, '-B', build, '-G', 'Ninja',
    '-DCMAKE_MAKE_PROGRAM=' + str(a.ninja.resolve()),
    '-DCMAKE_TOOLCHAIN_FILE=' + str(em / 'cmake/Modules/Platform/Emscripten.cmake'),
    '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
    '-DBUILD_CODEC=OFF', '-DBUILD_TESTING=OFF', '-DBUILD_UNIT_TESTS=OFF',
    '-DBUILD_JPIP=OFF', '-DOPJ_USE_THREAD=OFF', '-DCMAKE_C_FLAGS=-O3 -DNDEBUG')
run(a.cmake.resolve(), '--build', build, '--parallel', a.jobs, '--target', 'openjp2')
run(sys.executable, em / 'emcc.py', package / 'bridge.c', build / 'bin/libopenjp2.a',
    '-I' + str(source / 'src/lib/openjp2'), '-I' + str(build / 'src/lib/openjp2'),
    '-O3', '-DNDEBUG', '--no-entry', '-sMODULARIZE=1',
    '-sEXPORT_NAME=ViewerJpeg2000Module', '-sSINGLE_FILE=1',
    '-sSINGLE_FILE_BINARY_ENCODE=0', '-sENVIRONMENT=worker,node',
    '-sALLOW_MEMORY_GROWTH=1', '-sMALLOC=emmalloc',
    '-sINITIAL_MEMORY=33554432', '-sMAXIMUM_MEMORY=805306368',
    '-sSTACK_SIZE=1048576', '-sFILESYSTEM=0', '-sDYNAMIC_EXECUTION=0',
    '-sEMIT_EMSCRIPTEN_LICENSE=1',
    '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(['HEAPU8', 'HEAPU32', 'HEAP32']),
    '-sEXPORTED_FUNCTIONS=' + json.dumps(['_' + name for name in
        ('malloc', 'free', 'eval_encode', 'eval_decode', 'eval_free')]),
    '-o', a.output.resolve())
print('Built', a.output.resolve())
