// Project build helper: MIT. The input modules retain their own licenses.
const fs = require('node:fs');
const path = require('node:path');
// The parent project supplies its build tool; standalone npm use resolves locally.
function buildGifenc({ buildSync = require('esbuild').buildSync } = {}) {
  return buildSync({
    absWorkingDir: __dirname, entryPoints: ['src/index.js'], bundle: true,
    write: false, format: 'cjs', platform: 'neutral', target: 'es2018',
    charset: 'utf8', legalComments: 'inline',
    banner: { js: '// gifenc 1.0.3: MIT portions; PnnQuant-derived pnnquant2.js: MPL-2.0. See LICENSE, MPL-2.0, NOTICE.md and src/ in the accompanying source package.' }
  }).outputFiles[0].text;
}
module.exports = { buildGifenc };
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, 'gifenc.cjs'), buildGifenc());
  console.log('Built gifenc.cjs from the supplied sources.');
}
