// Explicit release inputs. No directory walks, user files or archives.
const codecNames = ['pako-2.1.0.min.js', 'UPNG-2.1.0.js', 'UTIF-3.1.0.js', 'gifenc-1.0.3.browser.js', 'heic-decoder.js', 'jpeg-decoder.js', 'modern-codecs.js', 'bmp-decoder.js', 'tiff-codec.js'];
const licenseNames = ['pako-LICENSE', 'pako-ZLIB-LICENSE', 'UPNG-LICENSE', 'UTIF-LICENSE', 'UTIF-JPEG-NOTICE', 'Apache-2.0-LICENSE', 'gifenc-LICENSE', 'gifenc-NOTICE', 'PnnQuant-MPL-2.0', 'gif-js-LICENSE', 'gif-codec-LICENSE', 'libheif-COPYING', 'libde265-COPYING'];
licenseNames.push('kvazaar-LICENSE', 'kvazaar-CREDITS', 'kvazaar-NOTICE', 'HEIC-NOTICE', 'HEIC-RUNTIME-NOTICE', 'Emscripten-LICENSE', 'Emscripten-AUTHORS', 'musl-COPYRIGHT', 'libcxx-LICENSE', 'libcxxabi-LICENSE', 'compiler-rt-LICENSE', 'compiler-rt-CREDITS', 'llvm-libc-LICENSE');
const heicSourceNames = require('../vendor/sources/heic/package-files.json').files.map(name => 'sources/heic/' + name);
const jpegSourceNames = ['sources/utif/UTIF.js', 'sources/utif/upstream.json', 'sources/utif/README.md',
  ...['bridge.c', 'build.py', 'sources.lock.json', 'PROJECT-LICENSE', 'README.md', 'upstream/libjpeg-turbo-3.2.0-sources.tar.gz'].map(name => 'sources/jpeg/' + name)];
licenseNames.push('libjpeg-turbo-LICENSE', 'libjpeg-turbo-README.ijg', 'JPEG-NOTICE', 'JPEG-RUNTIME-NOTICE');
const modernFiles = require('../vendor/sources/modern/package-files.json');
const modernSourceNames = modernFiles.files.map(name => 'sources/modern/' + name);
licenseNames.push(...modernFiles.licenseFiles);
const rasterSourceNames = ["bmp-bridge.c","tiff-bridge.c","build.py","sources.lock.json","PROJECT-LICENSE","README.md","upstream/libnsbmp-0.1.7-sources.tar.gz","upstream/libtiff-4.7.2-sources.tar.gz","upstream/zlib-1.3.2-sources.tar.gz"].map(name => 'sources/raster/' + name);
licenseNames.push('libnsbmp-LICENSE', 'libtiff-LICENSE', 'zlib-LICENSE', 'RASTER-NOTICE', 'RASTER-RUNTIME-NOTICE');
const binaryNames = ['heic-sources.zip', 'gifenc-1.0.3-sources.zip'];
const gifencModules = ['color.js', 'constants.js', 'index.js', 'lzwEncode.js', 'palettize.js', 'pnnquant2.js', 'rgb-packing.js', 'stream.js'];
const sourceLicenses = { 'LICENSE': 'gifenc-LICENSE', 'MPL-2.0': 'PnnQuant-MPL-2.0', 'NOTICE.md': 'gifenc-NOTICE', 'gif-js-LICENSE': 'gif-js-LICENSE', 'gif-codec-LICENSE': 'gif-codec-LICENSE' };
const sourceNames = [...gifencModules.map(name => 'sources/gifenc-1.0.3/src/' + name), ...['package.json', 'build.cjs', 'README.md', 'PROJECT-LICENSE', ...Object.keys(sourceLicenses)].map(name => 'sources/gifenc-1.0.3/' + name)];
const extraSources = {
  'gifenc-1.0.3.cjs': 'Built from sources/gifenc-1.0.3/src by sources/gifenc-1.0.3/build.cjs',
  'UTIF-JPEG-NOTICE': 'Adaptation notice: original embedded JPEG removed and replaced by libjpeg-turbo; source revision recorded inside',
  'Apache-2.0-LICENSE': 'https://www.apache.org/licenses/LICENSE-2.0.txt',
  'gifenc-NOTICE': 'Collection of upstream PnnQuant / LZW credits; exact sources cited inside',
  'PnnQuant-MPL-2.0': 'https://raw.githubusercontent.com/takase1121/PnnQuant.js/1a8577ad21bcd3871dc5c90a6d880ae0074c5389/LICENSE',
  'gif-js-LICENSE': 'https://raw.githubusercontent.com/jnordberg/gif.js/master/LICENSE',
  'gif-codec-LICENSE': 'https://api.github.com/repos/potomak/gif-codec/license',
  'components.json': 'Project component registry with licenses and source references'
};
for (const name of gifencModules) extraSources['sources/gifenc-1.0.3/src/' + name] = 'https://raw.githubusercontent.com/mattdesl/gifenc/15e2c3e65ed03c977b42fec48de59b05ee9b9f54/src/' + name + (name === 'pnnquant2.js' ? ' (MPL notice added; algorithm unchanged)' : '');
for (const name of sourceNames.filter(name => !name.includes('/src/'))) extraSources[name] = 'Project source-package helper or license copy; see source package README.md';
for (const name of heicSourceNames) extraSources[name] = 'HEIC source/recombination package; see sources/heic/README.md and sources.lock.json';
for (const name of ["kvazaar-LICENSE", "kvazaar-CREDITS", "kvazaar-NOTICE", "libheif-COPYING", "libde265-COPYING", "HEIC-NOTICE", "HEIC-RUNTIME-NOTICE", "Emscripten-LICENSE", "Emscripten-AUTHORS", "musl-COPYRIGHT", "libcxx-LICENSE", "libcxxabi-LICENSE", "compiler-rt-LICENSE", "compiler-rt-CREDITS", "llvm-libc-LICENSE"]) extraSources[name] = 'Pinned HEIC library / Emscripten runtime notice; see HEIC-NOTICE';
extraSources['heic-decoder.js'] = 'Built from sources/heic/ using Emscripten 6.0.9; libheif 1.23.4, libde265 1.1.2 and Kvazaar 2.3.2';
extraSources['heic-sources.zip'] = 'Deterministic package of sources/heic/package-files.json';
extraSources['gifenc-1.0.3-sources.zip'] = 'Deterministic package of the explicit gifenc sourceNames list in scripts/vendor-files.cjs';
for (const name of jpegSourceNames) extraSources[name] = 'Pinned JPEG source / adapted UTIF source; see sources/jpeg/README.md and sources/utif/README.md';
for (const name of ['libjpeg-turbo-LICENSE', 'libjpeg-turbo-README.ijg', 'JPEG-NOTICE', 'JPEG-RUNTIME-NOTICE']) extraSources[name] = 'libjpeg-turbo 3.2.0 and Emscripten 6.0.9; see JPEG-NOTICE';
extraSources['jpeg-decoder.js'] = 'Built from sources/jpeg/ using Emscripten 6.0.9; libjpeg-turbo 3.2.0';
extraSources['UTIF-3.1.0.js'] = 'Adapted sources/utif/UTIF.js; original embedded JPEG removed; see UTIF-JPEG-NOTICE';
for (const name of [...modernSourceNames, ...modernFiles.licenseFiles, 'modern-codecs.js']) extraSources[name] = 'Pinned sources and notices for WebP / JPEG XL / AVIF; see MODERN-NOTICE';
for (const name of [...rasterSourceNames, 'libnsbmp-LICENSE', 'libtiff-LICENSE', 'zlib-LICENSE', 'RASTER-NOTICE', 'RASTER-RUNTIME-NOTICE', 'bmp-decoder.js', 'tiff-codec.js']) extraSources[name] = 'Pinned BMP/TIFF libraries and source build; see sources/raster/README.md and RASTER-NOTICE';
module.exports = { rasterSourceNames, modernSourceNames, heicSourceNames, jpegSourceNames, binaryNames, codecNames, licenseNames, sourceNames, sourceLicenses, extraSources };
