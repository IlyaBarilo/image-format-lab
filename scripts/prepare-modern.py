"""Select pinned codec source files; never walks the workspace. MIT, Ilya Barilo 2026."""
import argparse, gzip, hashlib, io, json, tarfile
from pathlib import Path, PurePosixPath

p = argparse.ArgumentParser(); p.add_argument('downloads', type=Path); args = p.parse_args()
root = Path(__file__).resolve().parent.parent
specs = {
 'aom': ('3.15.0','de4c1d1edc49723a78954d30a83690aa1937422f','208e5aa0aa95986fd1d41fd96f1a74ee4d90f214ba5ccb64c6fe10430e127a95','https://aomedia.googlesource.com/aom/+archive/refs/tags/v3.15.0.tar.gz'),
 'webp': ('1.6.0','4fa21912338357f89e4fd51cf2368325b59e9bd9','e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564','https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz'),
 'jxl': ('0.12.0','a7a9c787341cf703dede03c2009fa460cae5e5df','03e9be69a30be4011f559da75328b6d7cea8ad921fabfbd551ce10bf45cdc992','https://github.com/libjxl/libjxl/archive/refs/tags/v0.12.0.tar.gz'),
 'brotli': ('028fb5a','028fb5a23661f123017c060daa546b55cf4bde29','0afe09a53c8bad9861c8dd1fc1284308d54f19d2979ba3541cfdcc9b05fe360f','https://github.com/google/brotli/archive/028fb5a23661f123017c060daa546b55cf4bde29.tar.gz'),
 'highway': ('457c891','457c891775a7397bdb0376bb1031e6e027af1c48','5124b0501c98d9930dbb065bfa1a5bbbd59ce0f12facb7e1e33aaef01a5f1f1a','https://github.com/google/highway/archive/457c891775a7397bdb0376bb1031e6e027af1c48.tar.gz'),
 'skcms': ('96d9171','96d9171c94b937a1b5f0293de7309ac16311b722','8f4a9b36a067d18e9616c6ea850f326d52cd5e0f91a06bf1963d8eef8da062f5','https://skia.googlesource.com/skcms/+archive/96d9171c94b937a1b5f0293de7309ac16311b722.tar.gz')}
suffixes = {'.template','.pl','.ac','.am','.m4','.bzl','.build','.c','.cc','.cpp','.h','.hpp','.inc','.cmake','.txt','.md','.in','.py','.sh','.S','.s','.asm','.pc','.def','.map','.rc','.rst'}
licenses = {'LICENSE','COPYING','PATENTS','AUTHORS','NOTICE','LICENSE-BSD3','LICENSE.libjxl','LICENSE-Apache2'}
lock = {'toolchain': {'emscripten':'6.0.9'}, 'libraries':{}}
package = root/'vendor/sources/modern'; (package/'upstream').mkdir(parents=True,exist_ok=True)
for name,(version,commit,expected,url) in specs.items():
 archive=args.downloads/(name+'.tar.gz'); assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected,name
 files=[]
 with tarfile.open(archive) as source:
  for member in source.getmembers():
   if not member.isfile(): continue
   parts=PurePosixPath(member.name).parts
   if '..' in parts or '\\' in member.name or member.name.startswith('/'): raise ValueError(member.name)
   relative='/'.join(parts if name in ('aom','skcms') else parts[1:]); path=PurePosixPath(relative)
   if not relative or (path.suffix not in suffixes and path.name not in licenses | {'CHANGELOG','NEWS','VERSION'}): continue
   if name=='webp' and len(path.parts)>1 and path.parts[0] not in {'src','sharpyuv','cmake'}: continue
   if name=='webp' and len(path.parts)==1 and path.name not in {'CMakeLists.txt','configure.ac','COPYING','PATENTS','AUTHORS','NEWS','README.md','README'}: continue
   if name=='aom' and relative.startswith(('third_party/googletest/','third_party/libyuv/','third_party/libwebm/')): continue
   if name=='jxl' and relative.startswith('third_party/HEVCSoftware/'): continue
   if name=='skcms' and len(path.parts)>1 and path.parts[0]!='src': continue
   data=source.extractfile(member).read(); files.append((name+'-'+version+'/'+relative,data))
   if path.name in licenses and (len(path.parts)==1 or name=='aom'):
    (root/'vendor'/('modern-'+name+'-'+relative.replace('/','-'))).write_bytes(data)
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w',format=tarfile.PAX_FORMAT) as dest:
  for filename,data in sorted(files):
   m=tarfile.TarInfo(filename);m.mode=0o644;m.size=len(data);dest.addfile(m,io.BytesIO(data))
 data=gzip.compress(out.getvalue(),mtime=0); archive_name=name+'-'+version+'-sources.tar.gz'
 destination = root/'vendor/sources/heic/upstream' if name=='aom' else package/'upstream'
 (destination/archive_name).write_bytes(data)
 lock['libraries'][name]={'version':version,'commit':commit,'url':url,'upstreamSha256':expected,'archive':archive_name,'sha256':hashlib.sha256(data).hexdigest(),'files':len(files),'selection':'Unmodified source/build text and notices. No upstream image fixtures; unused bundled test libraries excluded.'}
 (package/'sources.lock.json').write_text(json.dumps(lock,indent=2)+'\n',encoding='utf-8')
 if name=='aom':
  heic_lock_path=root/'vendor/sources/heic/sources.lock.json'
  heic_lock=json.loads(heic_lock_path.read_text(encoding='utf-8'))
  heic_lock['aom']=lock['libraries']['aom']
  heic_lock_path.write_text(json.dumps(heic_lock,indent=2)+'\n',encoding='utf-8')
 print(name,len(files),len(data))
