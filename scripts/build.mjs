import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateRawSync, gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as bundle } from 'esbuild';
import vendorFiles from './vendor-files.cjs';
import { sourcePackages, githubSourceConfig } from './source-release.mjs';
import { releaseVersion, verifyReleaseCheckout } from './build-version.mjs';
import sourceZipTools from './source-zip.cjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { modernSourceNames, codecNames, licenseNames, sourceNames, heicSourceNames, jpegSourceNames, binaryNames } = vendorFiles;
const noticeNames = ['LICENSE', 'NOTICE.md', 'ASSETS.md', 'docs/licenses/esbuild-LICENSE', 'docs/licenses/acorn-LICENSE'];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
// Git stores project text as LF. Keep the generated HTML independent of the
// editor/checkout line endings; pinned vendor files continue to use raw bytes.
const readProjectText = name => read(name).replace(/\r\n?/g, '\n');
const jsonForHtml = value => JSON.stringify(value).replace(/</g, '\\u003c');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function portableGzip(bytes) {
  const compressed = gzipSync(bytes, { level: 9 });
  // RFC 1952: OS=255 (unknown). zlib's host marker must not change HTML
  // between Windows and Linux; payload, CRC and original size stay intact.
  compressed[9] = 255;
  return compressed;
}

function codecs(config, release, compressCodecs) {
  const manifest = JSON.parse(read('vendor/manifest.json'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid vendor manifest');
  const scripts = {}, licenses = {};
  let components;
  for (const name of [...codecNames, ...licenseNames, ...sourceNames, ...heicSourceNames, ...jpegSourceNames, ...modernSourceNames, ...binaryNames, 'components.json']) {
    const matches = manifest.files.filter(item => item.file === name);
    if (matches.length !== 1) throw new Error('Missing or duplicated vendor entry: ' + name);
    const bytes = fs.readFileSync(path.join(root, 'vendor', name));
    if (bytes.length !== matches[0].bytes || sha256(bytes) !== matches[0].sha256) throw new Error('Vendor integrity check failed: ' + name);
    if (codecNames.includes(name)) scripts['vendor/' + name] = compressCodecs && ['heic-decoder.js', 'jpeg-decoder.js', 'modern-codecs.js'].includes(name)
      ? { encoding: 'gzip-base64', bytes: bytes.length, data: portableGzip(bytes).toString('base64') }
      : bytes.toString('utf8');
    else if (licenseNames.includes(name)) licenses[name] = bytes.toString('utf8');
    else if (name === 'components.json') components = JSON.parse(bytes.toString('utf8'));
  }
  // A hash alone cannot detect a stale source ZIP after its inputs were edited.
  const archive = fs.readFileSync(path.join(root, 'vendor/heic-sources.zip')), found = new Set();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6), method = archive.readUInt16LE(offset + 8);
    if (flags & 8 || ![0, 8].includes(method)) throw new Error('Unsupported source ZIP encoding');
    const size = archive.readUInt32LE(offset + 18), names = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + names).toString('utf8');
    const input = name.startsWith('heic-sources/') ? 'sources/heic/' + name.slice(13) : '';
    if (!heicSourceNames.includes(input) || found.has(input)) throw new Error('Unexpected HEIC source ZIP entry: ' + name);
    found.add(input);
    const start = offset + 30 + names + extra, compressed = archive.subarray(start, start + size);
    const decoded = method === 8 ? inflateRawSync(compressed) : compressed;
    if (!decoded.equals(fs.readFileSync(path.join(root, 'vendor', input)))) throw new Error('HEIC source ZIP is stale: ' + input);
    offset = start + size;
  }
  if (found.size !== heicSourceNames.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Incomplete HEIC source ZIP');
  const gifencZip = sourceZipTools.sourceZip(sourceNames.map(name => ({ name: name.slice('sources/'.length), bytes: fs.readFileSync(path.join(root, 'vendor', name)) })));
  if (!gifencZip.equals(fs.readFileSync(path.join(root, 'vendor/gifenc-1.0.3-sources.zip')))) throw new Error('gifenc source ZIP is stale; run scripts/build-vendor.cjs');
  if (read('vendor/UTIF-3.1.0.js') !== read('vendor/sources/utif/UTIF.js')) throw new Error('UTIF artifact is stale; run scripts/build-vendor.cjs');
  if (components?.version !== 1 || !Array.isArray(components.components) || !components.components.length) throw new Error('Invalid component registry');
  const ids = new Set();
  for (const item of components.components) {
    if (!item.id || ids.has(item.id) || !item.name || !item.license || !['documented', 'review'].includes(item.status)) throw new Error('Invalid or duplicated component: ' + item.id);
    ids.add(item.id);
    if (!Array.isArray(item.licenseFiles) || !item.licenseFiles.length || item.licenseFiles.some(name => !licenseNames.includes(name) && !noticeNames.includes(name))) throw new Error('Missing component license: ' + item.id);
    if (!Array.isArray(item.sources) || item.sources.some(source => !/^https:\/\//.test(source.url))) throw new Error('Invalid source URL: ' + item.id);
  }
  return { scripts, licenses, sourcePackages: sourcePackages(config, manifest, { release }), components, manifest };
}

function replaceOnce(text, marker, value) {
  if (text.split(marker).length !== 2) throw new Error('Expected one template marker: ' + marker);
  return text.replace(marker, () => value);
}

export async function buildViewer({ test = false, debug = false, release = false, tag = null, compressCodecs = true, sourceConfig = JSON.parse(read('scripts/source-release.json')) } = {}) {
  const releaseTag = releaseVersion({ release, tag });
  const payload = codecs(sourceConfig, release, compressCodecs);
  payload.releaseTag = releaseTag;
  const notices = Object.fromEntries(noticeNames.map(name => [name, readProjectText(name)]));
  const common = { absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', charset: 'utf8', legalComments: 'inline', metafile: true, logLevel: 'silent' };
  const theme = await bundle({ ...common, entryPoints: ['src/theme-startup.mjs'], minify: true });
  const worker = await bundle({ ...common, entryPoints: ['src/workers/compute.worker.mjs'] });
  const heicWorker = await bundle({ ...common, entryPoints: ['src/workers/heic.worker.mjs'] });
  const modernWorker = await bundle({ ...common, entryPoints: ['src/workers/modern.worker.mjs'] });
  const tiffWorker = await bundle({ ...common, entryPoints: ['src/workers/tiff.worker.mjs'] });
  const app = await bundle({ ...common, entryPoints: [test ? 'tests/support/browser-entry.mjs' : 'src/main.mjs'], sourcemap: debug ? 'inline' : false,
    plugins: [{ name: 'embedded-worker', setup(build) {
      build.onResolve({ filter: /^viewer:(compute|heic|tiff|modern)-worker$/ }, args => ({ path: args.path.slice(7), namespace: 'embedded' }));
      build.onLoad({ filter: /.*/, namespace: 'embedded' }, args => ({ contents: ({ 'modern-worker': modernWorker, 'heic-worker': heicWorker, 'tiff-worker': tiffWorker, 'compute-worker': worker })[args.path].outputFiles[0].text, loader: 'text' }));
    } }]
  });
  const inputs = [...new Set([...Object.keys(theme.metafile.inputs), ...Object.keys(worker.metafile.inputs), ...Object.keys(modernWorker.metafile.inputs), ...Object.keys(heicWorker.metafile.inputs), ...Object.keys(tiffWorker.metafile.inputs), ...Object.keys(app.metafile.inputs)])].filter(name => !name.startsWith('embedded:'));
  // Validate the entire dependency graph, not a recursive filesystem inventory.
  for (const name of inputs) {
    if (!name.startsWith('src/') && !(test && name.startsWith('tests/support/'))) throw new Error('Unexpected application dependency: ' + name);
  }
  const css = readProjectText('src/styles.css');
  if (/<\/style/i.test(css)) throw new Error('Unexpected closing style tag in CSS');
  let html = readProjectText('src/index.html');
  html = replaceOnce(html, '<!-- VIEWER_FAVICON -->', '<link rel="icon" type="image/svg+xml" sizes="any" href="data:image/svg+xml;base64,' + Buffer.from(readProjectText('src/favicon.svg'), 'utf8').toString('base64') + '">');
  if (/<\/script/i.test(theme.outputFiles[0].text)) throw new Error('Unexpected closing script tag in theme startup');
  html = replaceOnce(html, '<!-- VIEWER_THEME -->', '<script id="viewer-theme">' + theme.outputFiles[0].text + '</script>');
  html = replaceOnce(html, '<!-- VIEWER_ICONS -->', readProjectText('src/icons.svg'));
  html = replaceOnce(html, '<!-- VIEWER_NOTICES -->', '<script type="application/json" id="embedded-notices">' + jsonForHtml(notices) + '</script>');
  html = replaceOnce(html, '<!-- VIEWER_STYLES -->', '<style>\n' + css + '</style>');
  html = replaceOnce(html, '<!-- VIEWER_CODECS -->', '<script type="application/json" id="embedded-codecs">' + jsonForHtml(payload) + '</script>');
  // esbuild escapes inline-script sequences in its JavaScript output by default.
  if (/<\/script/i.test(app.outputFiles[0].text)) throw new Error('Unexpected closing script tag in bundle');
  html = replaceOnce(html, '<!-- VIEWER_SCRIPT -->', '<script>\n' + app.outputFiles[0].text + '</script>');
  html = html.replace(/<!doctype html>/i, match => match + '\n<!-- Generated from src/ by npm --prefix scripts run build. Edit the sources; this file is rebuilt. -->');
  return { html, inputs, bytes: Buffer.byteLength(html), sha256: sha256(html), watchFiles: [...inputs, ...noticeNames, 'src/index.html', 'src/styles.css', 'src/icons.svg', 'src/favicon.svg', 'vendor/manifest.json', 'vendor/components.json', ...[...codecNames, ...licenseNames, ...sourceNames, ...heicSourceNames, ...jpegSourceNames, ...modernSourceNames, ...binaryNames].map(n => 'vendor/' + n), 'scripts/build.mjs', 'scripts/build-version.mjs', 'scripts/vendor-files.cjs', 'scripts/source-release.mjs', 'scripts/source-release.json', 'scripts/source-zip.cjs', 'scripts/package.json', 'scripts/package-lock.json'] };
}

function writeOutput(html, destination) {
  const temporary = destination + '.building-' + crypto.randomUUID();
  try { fs.writeFileSync(temporary, html); fs.renameSync(temporary, destination); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

async function main() {
  const args = process.argv.slice(2), allowed = new Set(['--watch', '--check', '--test', '--debug', '--release']);
  if (args.some(arg => !allowed.has(arg) && !['--output=', '--tag=', '--repository='].some(prefix => arg.startsWith(prefix)))) throw new Error('Unknown build argument');
  const release = args.includes('--release'), tags = args.filter(arg => arg.startsWith('--tag='));
  if (tags.length > 1) throw new Error('Choose exactly one release tag');
  const tag = releaseVersion({ release, tag: tags.length ? tags[0].slice(6) : null });
  const repositories = args.filter(arg => arg.startsWith('--repository='));
  if (repositories.length > 1 || (repositories.length && !release)) throw new Error('--repository requires one repository and --release');
  const sourceConfig = repositories.length ? githubSourceConfig(repositories[0].slice(13), tag) : undefined;
  if (release && ['--watch', '--test', '--debug'].some(arg => args.includes(arg))) throw new Error('Release cannot use watch, test instrumentation or debug sourcemaps');
  if (release) verifyReleaseCheckout(tag, root);
  const test = args.includes('--test');
  const supplied = args.find(arg => arg.startsWith('--output='))?.slice(9);
  if (supplied && !test) throw new Error('The public build always writes image-format-lab.html in the project root');
  if (test && !supplied) throw new Error('Test builds require an explicit temporary output path');
  const destination = supplied ? path.resolve(supplied) : path.join(root, 'image-format-lab.html');
  const relativeOutput = path.relative(root, destination).replaceAll('\\', '/').toLowerCase();
  if (relativeOutput === 'local' || relativeOutput.startsWith('local/')) throw new Error('User local files are excluded from build output');
  if (test && destination.toLowerCase() === path.join(root, 'image-format-lab.html').toLowerCase()) throw new Error('A test build cannot replace the public HTML');
  if (args.includes('--watch') && (test || supplied || args.includes('--check'))) throw new Error('Watch is only supported for the normal root build');
  let busy = false, again = false;
  const watched = new Set();
  async function rebuild() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const result = await buildViewer({ test, debug: args.includes('--debug'), release, tag, sourceConfig });
      if (args.includes('--check')) {
        if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== result.html) throw new Error('HTML is stale; run npm --prefix scripts run build');
      } else writeOutput(result.html, destination);
      console.log(`${path.basename(destination)}: ${result.bytes} bytes; ${result.inputs.length} module inputs; ${args.includes('--check') ? 'up to date' : 'built'}`);
      if (args.includes('--watch')) for (const name of result.watchFiles) {
        const file = path.join(root, name);
        if (!watched.has(file)) { watched.add(file); fs.watchFile(file, { interval: 700 }, () => { rebuild().catch(console.error); }); }
      }
    } catch (error) { if (!args.includes('--watch') || watched.size === 0) throw error; console.error('Build failed; previous HTML retained:', error.message); }
    finally { busy = false; if (again) { again = false; await rebuild(); } }
  }
  await rebuild();
  if (args.includes('--watch')) {
    // Restart the watcher after edits to build.mjs or vendor-files.cjs to reload build code.
    console.log('Watching explicit source/dependency files. Ctrl+C to stop.');
    process.once('SIGINT', () => { for (const file of watched) fs.unwatchFile(file); process.exit(0); });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1; });
