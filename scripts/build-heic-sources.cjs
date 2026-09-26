// Rebuild the separate HEIC source package from its explicit allowlist.
// Own code: MIT. No workspace traversal or external downloads.
const fs = require('node:fs');
const path = require('node:path');
const { sourceZip } = require('./source-zip.cjs');
const root = path.resolve(__dirname, '..');
const { files } = require('../vendor/sources/heic/package-files.json');
const sourceRoot = path.join(root, 'vendor/sources/heic');
const entries = files.map(name => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid HEIC source path');
  const source = path.resolve(sourceRoot, name);
  if (!source.startsWith(sourceRoot + path.sep)) throw new Error('HEIC source escapes package');
  return { name: 'heic-sources/' + name, bytes: fs.readFileSync(source) };
});
fs.writeFileSync(path.join(root, 'vendor/heic-sources.zip'), sourceZip(entries));
console.log('Prepared HEIC source package from', entries.length, 'explicit files.');
