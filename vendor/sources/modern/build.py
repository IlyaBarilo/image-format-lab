"""Offline build of pinned libwebp/libjxl and dependencies. MIT, Ilya Barilo 2026."""
import argparse, hashlib, json, os, shutil, subprocess, sys, tarfile
from pathlib import Path
p=argparse.ArgumentParser()
for name in ('sdk','work','cmake','ninja','output'): p.add_argument('--'+name,required=True,type=Path)
p.add_argument('--jobs',type=int,default=4);p.add_argument('--libraries-only',action='store_true')
a=p.parse_args(); package=Path(__file__).resolve().parent;lock=json.loads((package/'sources.lock.json').read_text())
work=a.work.resolve()
if work==package or work in package.parents: raise SystemExit('Build directory must not contain source package')
work.mkdir(parents=True,exist_ok=True);sdk=a.sdk.resolve();em=sdk/'upstream/emscripten'
env=dict(os.environ,EMSDK=str(sdk),EMSDK_PYTHON=sys.executable,EM_CONFIG=str(sdk/'.emscripten'),EM_CACHE=str(work/'emscripten-cache'),SOURCE_DATE_EPOCH='1758067200')
env['PATH']=os.pathsep.join([str(Path(sys.executable).parent),str(em),str(a.cmake.resolve().parent),str(a.ninja.resolve().parent),env['PATH']])
def run(cmd):
 print('+',' '.join(map(str,cmd)),flush=True);subprocess.run(list(map(str,cmd)),env=env,check=True)
version=subprocess.check_output([sys.executable,str(em/'emcc.py'),'--version'],env=env,text=True)
if lock['toolchain']['emscripten'] not in version.splitlines()[0]: raise SystemExit('Wrong Emscripten version')
sources={}
for name,info in lock['libraries'].items():
 if name=='aom': continue # Included in the separate libheif source kit.
 archive=package/'upstream'/info['archive'];assert hashlib.sha256(archive.read_bytes()).hexdigest()==info['sha256'],name
 prefix=name+'-'+info['version'];sources[name]=work/prefix
 with tarfile.open(archive) as tar:
  for member in tar.getmembers():
   if not (work/member.name).resolve().is_relative_to(work) or not member.name.startswith(prefix+'/'): raise ValueError(member.name)
  tar.extractall(work,filter='data')
for name in ('brotli','highway','skcms'):
 shutil.copytree(sources[name],sources['jxl']/'third_party'/name,dirs_exist_ok=True)
common=['-G','Ninja','-DCMAKE_MAKE_PROGRAM='+str(a.ninja.resolve()),'-DCMAKE_TOOLCHAIN_FILE='+str(em/'cmake/Modules/Platform/Emscripten.cmake'),'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DBUILD_TESTING=OFF','-DCMAKE_C_FLAGS=-ffile-prefix-map='+work.as_posix()+'=.','-DCMAKE_CXX_FLAGS=-ffile-prefix-map='+work.as_posix()+'=.']
wb=work/'webp-build';jb=work/'jxl-build'
run([a.cmake.resolve(),'-S',sources['webp'],'-B',wb,*common,*['-DWEBP_BUILD_'+n+'=OFF' for n in ['ANIM_UTILS','CWEBP','DWEBP','GIF2WEBP','IMG2WEBP','VWEBP','WEBPINFO','WEBPMUX','EXTRAS']],'-DWEBP_USE_THREAD=OFF','-DWEBP_ENABLE_SIMD=OFF'])
run([a.cmake.resolve(),'--build',wb,'--clean-first','--parallel',a.jobs,'--target','webp'])
disabled=['TOOLS','DEVTOOLS','FUZZERS','DOXYGEN','MANPAGES','BENCHMARK','EXAMPLES','JNI','SJPEG','OPENEXR','VIEWERS','TCMALLOC','PLUGINS','COVERAGE','WASM_THREADS']
run([a.cmake.resolve(),'-S',sources['jxl'],'-B',jb,*common,*['-DJPEGXL_ENABLE_'+n+'=OFF' for n in disabled],'-DJPEGXL_BUNDLE_LIBPNG=OFF','-DJPEGXL_ENABLE_SKCMS=ON','-DJPEGXL_ENABLE_TRANSCODE_JPEG=ON','-DJPEGXL_ENABLE_BOXES=ON','-DJPEGXL_FORCE_SYSTEM_BROTLI=OFF','-DPROVISION_DEPENDENCIES=OFF','-DCMAKE_CXX_FLAGS=-DHWY_COMPILE_ONLY_SCALAR -ffile-prefix-map='+work.as_posix()+'=.'])
run([a.cmake.resolve(),'--build',jb,'--clean-first','--parallel',a.jobs,'--target','jxl'])
if a.libraries_only: raise SystemExit(0)
exports=['malloc','free','viewer_modern_encode','viewer_modern_decode','viewer_modern_clear','viewer_modern_error','viewer_modern_output','viewer_modern_output_size','viewer_modern_width','viewer_modern_height']
out=a.output.resolve();out.parent.mkdir(parents=True,exist_ok=True)
run([sys.executable,em/'em++.py',package/'bridge.cpp',jb/'lib/libjxl.a',jb/'lib/libjxl_cms.a',jb/'third_party/brotli/libbrotlienc.a',jb/'third_party/brotli/libbrotlidec.a',jb/'third_party/brotli/libbrotlicommon.a',jb/'third_party/highway/libhwy.a',wb/'libwebp.a',wb/'libsharpyuv.a','-I'+str(sources['jxl']/'lib/include'),'-I'+str(jb/'lib/include'),'-I'+str(sources['webp']/'src'),'-O3','-std=c++17','--no-entry','-sMODULARIZE=1','-sEXPORT_NAME=ViewerModernModule','-sSINGLE_FILE=1','-sSINGLE_FILE_BINARY_ENCODE=0','-sENVIRONMENT=worker,node','-sALLOW_MEMORY_GROWTH=1','-sMALLOC=emmalloc','-sEMIT_EMSCRIPTEN_LICENSE=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=1073741824','-sSTACK_SIZE=1048576','-sFILESYSTEM=0','-sDYNAMIC_EXECUTION=0','-ffile-prefix-map='+package.as_posix()+'=modern-sources','-Wl,-Map='+str(out.with_suffix('.map')),'-sEXPORTED_FUNCTIONS='+json.dumps(['_'+n for n in exports]),'-sEXPORTED_RUNTIME_METHODS='+json.dumps(['HEAPU8','UTF8ToString']),'-o',out])
print(json.dumps({'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
