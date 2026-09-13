// Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
// Recombine an existing standalone application with a rebuilt HEIC library.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateRawSync, gzipSync } from 'node:zlib';
const [input, decoder, sources, output, sourceOption] = process.argv.slice(2);
if (!output || process.argv.length > 7 || (sourceOption && !sourceOption.startsWith('--source-url='))) throw new Error('Usage: node relink.mjs original.html rebuilt-heic.js updated-sources.zip modified.html [--source-url=https://host/version/updated-sources.zip]');
const sourceUrl = sourceOption ? sourceOption.slice('--source-url='.length) : null;
if (sourceUrl !== null) {
  const url = new URL(sourceUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Expected an absolute HTTPS source URL');
}
if ([input, decoder, sources].some(name => path.resolve(name) === path.resolve(output))) throw new Error('Output must be a separate file');
const original = fs.readFileSync(input, 'utf8');
const marker = /(<script type="application\/json" id="embedded-codecs">)([\s\S]*?)(<\/script>)/;
const match = original.match(marker);
if (!match) throw new Error('Embedded codec payload not found');
const payload = JSON.parse(match[2]);
if (!payload.sourcePackages?.heic || payload.sources || payload.sourceArchives) throw new Error('Use an HTML built for separate source packages; older embedded-source HTML requires its original relink tool');
const code = fs.readFileSync(decoder), archive = fs.readFileSync(sources);
if (!code.toString('utf8').includes('ViewerHeicModule')) throw new Error('Expected the ViewerHeicModule factory produced by build.py');
if (archive.length < 30 || archive.readUInt32LE(0) !== 0x04034b50) throw new Error('Expected the corresponding HEIC source ZIP');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = new Map();
let offset = 0;
while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
  const flags = archive.readUInt16LE(offset + 6), method = archive.readUInt16LE(offset + 8);
  if (flags & 9 || ![0, 8].includes(method)) throw new Error('Unsupported source ZIP encoding');
  const size = archive.readUInt32LE(offset + 18), names = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
  const name = archive.subarray(offset + 30, offset + 30 + names).toString('utf8');
  if (!name.startsWith('heic-sources/') || /[\\:\x00]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || entries.has(name)) throw new Error('Invalid source ZIP path');
  const start = offset + 30 + names + extra, bytes = archive.subarray(start, start + size);
  if (start + size > archive.length) throw new Error('Truncated source ZIP');
  const decoded = method === 8 ? inflateRawSync(bytes) : bytes;
  if (decoded.length !== archive.readUInt32LE(offset + 22)) throw new Error('Invalid source ZIP entry size');
  entries.set(name, decoded);
  offset = start + size;
}
if (offset + 4 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Incomplete source ZIP directory');
const list = JSON.parse(entries.get('heic-sources/package-files.json')?.toString('utf8') || '{}');
if (!Array.isArray(list.files) || list.files.length !== entries.size || list.files.some(name => !entries.has('heic-sources/' + name))) throw new Error('Incomplete source ZIP');
const lock = JSON.parse(entries.get('heic-sources/sources.lock.json').toString('utf8'));
for (const info of [lock.libheif, lock.libde265, lock.kvazaar, lock.aom]) {
  if (sha(entries.get('heic-sources/upstream/' + info.archive)) !== info.sha256) throw new Error('Source archive integrity check failed');
}
for (const [name, bytes] of entries) {
  const file = 'sources/heic/' + name.slice(13);
  const item = payload.manifest.files.find(item => item.file === file);
  if (item) Object.assign(item, { bytes: bytes.length, sha256: sha(bytes) });
  if (name.startsWith('heic-sources/licenses/')) {
    const license = name.slice('heic-sources/licenses/'.length);
    payload.licenses[license] = bytes.toString('utf8');
    const notice = payload.manifest.files.find(item => item.file === license);
    if (notice) Object.assign(notice, { bytes: bytes.length, sha256: sha(bytes) });
  }
}
const previous = payload.scripts['vendor/heic-decoder.js'];
if (typeof previous !== 'string' && previous?.encoding !== 'gzip-base64') throw new Error('Unsupported HEIC codec storage');
// Preserve the original HTML storage mode, including compatibility with plain JS.
payload.scripts['vendor/heic-decoder.js'] = typeof previous === 'string' ? code.toString('utf8')
  : { encoding: 'gzip-base64', bytes: code.length, data: gzipSync(code, { level: 9 }).toString('base64') };
payload.sourcePackages.heic = { name: path.basename(sources), bytes: archive.length, sha256: sha(archive), url: sourceUrl };
for (const [name, bytes] of [['heic-decoder.js', code], ['heic-sources.zip', archive]]) {
  const entry = payload.manifest.files.find(item => item.file === name);
  if (!entry) throw new Error('Missing manifest entry: ' + name);
  Object.assign(entry, { bytes: bytes.length, sha256: sha(bytes), url: sourceUrl || 'Locally rebuilt; corresponding sources supplied separately; publication URL not configured' });
}
for (const item of payload.components.components.filter(item => ['libheif', 'libde265', 'kvazaar', 'aom'].includes(item.id))) {
  item.notes = 'Локально пересобранный модуль HEIC/AVIF. Соответствующий исходный ZIP предоставляется отдельно; адрес и SHA-256 указаны в разделе комплектов исходников. ' + item.notes;
}
const registry = payload.manifest.files.find(item => item.file === 'components.json');
if (registry) {
  const bytes = Buffer.from(JSON.stringify(payload.components, null, 2) + '\n');
  Object.assign(registry, { bytes: bytes.length, sha256: sha(bytes) });
}
const replacement = match[1] + JSON.stringify(payload).replace(/</g, '\\u003c') + match[3];
const result = original.replace(marker, () => replacement);
fs.writeFileSync(output, result, { flag: 'wx' });
console.log(`${path.basename(output)}: ${Buffer.byteLength(result)} bytes; SHA-256 ${sha(Buffer.from(result))}`);
console.log(`Corresponding sources: ${path.basename(sources)}; SHA-256 ${sha(archive)}; ${sourceUrl || 'local build, publication URL not configured'}`);
