"""Build the included HEIC sources without fetching files or installing system tools.
Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tarfile

package = Path(__file__).resolve().parent
lock = json.loads((package / 'sources.lock.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, required=True, help='Activated portable emsdk directory')
parser.add_argument('--work', type=Path, required=True, help='New or reusable build directory')
parser.add_argument('--cmake', default='cmake')
parser.add_argument('--ninja', default='ninja')
parser.add_argument('--perl', default='perl', help='Perl 5 used by libaom RTCD generation')
parser.add_argument('--jobs', type=int, default=4)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--reuse-sources', action='store_true', help='Build already extracted, possibly modified sources in --work')
args = parser.parse_args()
args.cmake = shutil.which(args.cmake) or args.cmake
args.ninja = shutil.which(args.ninja) or args.ninja
work = args.work.resolve()
if work == package or work in package.parents:
    raise SystemExit('Build directory must not contain the source package')
work.mkdir(parents=True, exist_ok=True)
sdk = args.sdk.resolve()
emroot = sdk / 'upstream/emscripten'
env = dict(os.environ, EMSDK=str(sdk), EMSDK_PYTHON=sys.executable,
           EM_CONFIG=str(sdk / '.emscripten'), EM_CACHE=str(work / 'emscripten-cache'),
           SOURCE_DATE_EPOCH='1758067200')
env['PATH'] = os.pathsep.join([str(Path(sys.executable).parent), str(emroot),
    str(Path(args.ninja).resolve().parent), str(Path(args.cmake).resolve().parent), env['PATH']])

def run(command):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), env=env, check=True)

version = subprocess.check_output([sys.executable, str(emroot / 'emcc.py'), '--version'], env=env, text=True)
if lock['toolchain']['emscripten'] not in version.splitlines()[0]:
    raise SystemExit('Expected Emscripten ' + lock['toolchain']['emscripten'])

for name in ('libde265', 'libheif', 'kvazaar', 'aom'):
    info = lock[name]
    archive = package / 'upstream' / info['archive']
    if hashlib.sha256(archive.read_bytes()).hexdigest() != info['sha256']:
        raise SystemExit('Source integrity check failed: ' + name)
    prefix = name + '-' + info['version']
    if args.reuse_sources:
        if not (work / prefix / 'CMakeLists.txt').is_file():
            raise SystemExit('Extract the source package with an initial build before --reuse-sources')
        continue
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            target = (work / member.name).resolve()
            if not target.is_relative_to(work) or not (member.name == prefix or member.name.startswith(prefix + '/')):
                raise SystemExit('Unsafe source path: ' + member.name)
        source.extractall(work, filter='data')

toolchain = emroot / 'cmake/Modules/Platform/Emscripten.cmake'
prefix = work / 'install'
common = ['-G', 'Ninja', '-DCMAKE_MAKE_PROGRAM=' + str(Path(args.ninja).resolve()),
          '-DCMAKE_TOOLCHAIN_FILE=' + str(toolchain), '-DCMAKE_BUILD_TYPE=Release',
          '-DBUILD_SHARED_LIBS=OFF', '-DCMAKE_INSTALL_PREFIX=' + str(prefix),
          '-DCMAKE_C_FLAGS=-ffile-prefix-map=' + work.as_posix() + '=.',
          '-DCMAKE_CXX_FLAGS=-ffile-prefix-map=' + work.as_posix() + '=.']
de265_build = work / 'de265-build'
run([args.cmake, '-S', work / ('libde265-' + lock['libde265']['version']), '-B', de265_build, *common,
     '-DENABLE_DECODER=OFF', '-DENABLE_ENCODER=OFF', '-DENABLE_SDL=OFF', '-DENABLE_SIMD=OFF',
     '-DENABLE_SHERLOCK265=OFF', '-DENABLE_INTERNAL_DEVELOPMENT_TOOLS=OFF', '-DWITH_FUZZERS=OFF'])
# Source archives preserve timestamps. A fresh link must never reuse an object
# from a different source revision merely because its mtime is newer.
run([args.cmake, '--build', de265_build, '--clean-first', '--parallel', args.jobs])
run([args.cmake, '--install', de265_build])
heif_source = work / ('libheif-' + lock['libheif']['version'])
heif_build = work / 'heif-build'
kvazaar_build = work / 'kvazaar-build'
run([args.cmake, '-S', work / ('kvazaar-' + lock['kvazaar']['version']), '-B', kvazaar_build, *common,
     '-DBUILD_TESTS=OFF', '-DBUILD_KVAZAAR_BINARY=OFF', '-DUSE_CRYPTO=OFF'])
run([args.cmake, '--build', kvazaar_build, '--clean-first', '--parallel', args.jobs])
run([args.cmake, '--install', kvazaar_build])
aom_build = work / 'aom-build'
run([args.cmake, '-S', work / ('aom-' + lock['aom']['version']), '-B', aom_build, *common,
     '-DPERL_EXECUTABLE=' + (shutil.which(args.perl) or str(Path(args.perl).resolve())), '-DAOM_TARGET_CPU=generic', '-DENABLE_TESTS=OFF', '-DENABLE_EXAMPLES=OFF', '-DENABLE_TOOLS=OFF',
     '-DENABLE_DOCS=OFF', '-DENABLE_APPS=OFF', '-DCONFIG_LIBYUV=0', '-DCONFIG_TUNE_BUTTERAUGLI=0', '-DCONFIG_MULTITHREAD=0', '-DCONFIG_WEBM_IO=0', '-DCONFIG_AV1_HIGHBITDEPTH=1'])
run([args.cmake, '--build', aom_build, '--clean-first', '--parallel', args.jobs])
run([args.cmake, '--install', aom_build])

disabled = ['X265', 'UVG266', 'VVDEC', 'VVENC', 'X264', 'OpenH264_DECODER', 'DAV1D',
            'SvtEnc', 'RAV1E', 'JPEG_DECODER', 'JPEG_ENCODER',
            'OpenJPEG_ENCODER', 'OpenJPEG_DECODER', 'FFMPEG_DECODER', 'OPENJPH_ENCODER',
            'UNCOMPRESSED_CODEC', 'WEBCODECS', 'LIBSHARPYUV', 'HEADER_COMPRESSION',
            'EXAMPLES', 'GDK_PIXBUF', 'FUZZERS']
run([args.cmake, '-S', heif_source, '-B', heif_build, *common,
     '-DCMAKE_CXX_FLAGS=-D__EMSCRIPTEN_STANDALONE_WASM__=1 -ffile-prefix-map=' + work.as_posix() + '=.', '-DWITH_LIBDE265=ON',
     '-DLIBDE265_INCLUDE_DIR=' + str(prefix / 'include'), '-DLIBDE265_LIBRARY=' + str(prefix / 'lib/libde265.a'),
     '-DWITH_KVAZAAR=ON', '-DKVAZAAR_INCLUDE_DIR=' + str(prefix / 'include'), '-DKVAZAAR_LIBRARY=' + str(prefix / 'lib/libkvazaar.a'),
     '-DWITH_AOM_DECODER=ON', '-DWITH_AOM_ENCODER=ON', '-DAOM_INCLUDE_DIR=' + str(prefix / 'include'), '-DAOM_LIBRARY=' + str(prefix / 'lib/libaom.a'),
     '-DENABLE_PLUGIN_LOADING=OFF', '-DENABLE_MULTITHREADING_SUPPORT=OFF', '-DENABLE_PARALLEL_TILE_DECODING=OFF',
     '-DBUILD_TESTING=OFF', '-DBUILD_DOCUMENTATION=OFF', '-DBUILD_DEVELOPMENT_TOOLS=OFF',
     *['-DWITH_' + name + '=OFF' for name in disabled]])
run([args.cmake, '--build', heif_build, '--clean-first', '--parallel', args.jobs])
exports = ['malloc', 'free', 'viewer_heic_decode', 'viewer_heic_clear', 'viewer_heic_error',
           'viewer_heic_version', 'viewer_de265_version', 'viewer_heic_width', 'viewer_heic_height',
           'viewer_heic_pixels', 'viewer_heic_stride', 'viewer_heic_premultiplied',
           'viewer_heic_encode', 'viewer_heic_output', 'viewer_heic_output_size', 'viewer_heic_can_encode']
exports += ['viewer_avif_encode', 'viewer_avif_can_encode']
output = args.output.resolve()
output.parent.mkdir(parents=True, exist_ok=True)
run([sys.executable, emroot / 'em++.py', package / 'bridge.cpp',
     heif_build / 'libheif/libheif.a', prefix / 'lib/libde265.a', prefix / 'lib/libkvazaar.a', prefix / 'lib/libaom.a',
     '-I' + str(heif_source / 'libheif/api'), '-I' + str(heif_build), '-I' + str(prefix / 'include'),
     '-O3', '-std=c++17', '--no-entry', '-sMODULARIZE=1', '-sEXPORT_NAME=ViewerHeicModule',
     '-sSINGLE_FILE=1', '-sSINGLE_FILE_BINARY_ENCODE=0', '-sENVIRONMENT=worker,node', '-sALLOW_MEMORY_GROWTH=1',
     '-sMALLOC=emmalloc', '-sEMIT_EMSCRIPTEN_LICENSE=1',
     '-ffile-prefix-map=' + package.as_posix() + '=heic-sources', '-Wl,-Map=' + str(output.with_suffix('.map')),
     '-sINITIAL_MEMORY=33554432', '-sMAXIMUM_MEMORY=1073741824', '-sSTACK_SIZE=1048576',
     '-sFILESYSTEM=0', '-sDYNAMIC_EXECUTION=0', '-sWASM_ASYNC_COMPILATION=1',
     '-sEXPORTED_FUNCTIONS=' + json.dumps(['_' + name for name in exports]),
     '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(['HEAPU8', 'UTF8ToString']), '-o', output])
print(json.dumps({'file': output.name, 'bytes': output.stat().st_size,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
