// Build the supplied gifenc sources and wrap CommonJS for file:// classic scripts.
// Explicit input list: never walks user files or archives.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSync } = require('esbuild');
const { sourceLicenses, sourceNames, extraSources } = require('./vendor-files.cjs');
const { sourceZip } = require('./source-zip.cjs');
const { buildGifenc } = require('../vendor/sources/gifenc-1.0.3/build.cjs');
const root = path.resolve(__dirname, '..');
const sources = {
  'pako-2.1.0.min.js':'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
  'pako-LICENSE':'https://cdn.jsdelivr.net/npm/pako@2.1.0/LICENSE',
  'pako-ZLIB-LICENSE':'https://raw.githubusercontent.com/nodeca/pako/2.1.0/lib/zlib/README',
  'UPNG-2.1.0.js':'https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js',
  'UPNG-LICENSE':'https://cdn.jsdelivr.net/npm/upng-js@2.1.0/LICENSE',
  'UTIF-3.1.0.js':'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
  'UTIF-LICENSE':'https://cdn.jsdelivr.net/npm/utif@3.1.0/LICENSE',
  'gifenc-1.0.3.cjs':'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.js',
  'gifenc-LICENSE':'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/LICENSE.md',
};
const source = buildGifenc({ buildSync });
fs.copyFileSync(path.join(root, 'vendor/sources/utif/UTIF.js'), path.join(root, 'vendor/UTIF-3.1.0.js'));
fs.writeFileSync(path.join(root,'vendor/gifenc-1.0.3.cjs'),source);
for (const [destination, name] of Object.entries(sourceLicenses)) fs.copyFileSync(path.join(root,'vendor',name),path.join(root,'vendor/sources/gifenc-1.0.3',destination));
fs.writeFileSync(path.join(root,'vendor/sources/gifenc-1.0.3/PROJECT-LICENSE'),fs.readFileSync(path.join(root,'LICENSE'),'utf8').replace(/\r\n?/g,'\n'));
fs.writeFileSync(path.join(root,'vendor/gifenc-1.0.3.browser.js'),
  '// gifenc: MIT portions and MPL-2.0 PnnQuant. Source package and notices are available in the viewer Licenses window.\n(function(){const module={exports:{}};const exports=module.exports;\n'+
  source+'\nwindow.gifenc=module.exports;})();\n');
fs.writeFileSync(path.join(root, 'vendor/gifenc-1.0.3-sources.zip'), sourceZip(sourceNames.map(name => ({ name: name.slice('sources/'.length), bytes: fs.readFileSync(path.join(root, 'vendor', name)) }))));
const artifacts = {...sources, ...extraSources, 'gifenc-1.0.3.browser.js':'Generated wrapper of gifenc rebuilt from supplied sources; algorithm unchanged'};
const files=Object.entries(artifacts).map(([file,url])=>{const bytes=fs.readFileSync(path.join(root,'vendor',file));return {file,url,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
fs.writeFileSync(path.join(root,'vendor/manifest.json'),JSON.stringify({version:1,files},null,2)+'\n');
console.log('Prepared '+files.length+' explicit codec, license, source and registry files.');
