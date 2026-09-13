const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const requireBuildTool = createRequire(path.join(__dirname, '../scripts/package.json'));
const { parse } = requireBuildTool('acorn');
const { decodeScript } = require('./support/codec-payload.cjs');

(async () => {
  const { buildViewer, root } = await import('../scripts/build.mjs');
  const packagePath = path.join(root, 'scripts/package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'scripts/package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].devDependencies, packageJson.devDependencies);
  for (const name of ['package.json', 'package-lock.json']) assert.equal(fs.existsSync(path.join(root, name)), false, 'npm manifests belong in scripts/');
  for (const name of ['acorn', 'esbuild']) assert.ok(requireBuildTool.resolve(name).startsWith(path.join(root, 'scripts/node_modules') + path.sep), 'resolve tools from scripts/node_modules: ' + name);
  const currentHtml = fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8');
  const currentPayload = JSON.parse(currentHtml.match(/id="embedded-codecs">([\s\S]*?)<\/script>/)[1]);
  const tag = currentPayload.releaseTag ?? null;
  const options = { release: tag !== null, tag };
  if (tag) options.sourceConfig = { version: 1, urls: Object.fromEntries(Object.entries(currentPayload.sourcePackages).map(([id, info]) => [id, info.url])) };
  const first = await buildViewer(options), second = await buildViewer(options);
  assert.equal(first.html, second.html, 'same inputs must produce identical bytes');
  assert.ok(first.html.startsWith('<!doctype html>\n<!-- Generated from src/'));
  assert.equal(fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8'), first.html, 'root HTML must be current');
  console.log('PASS deterministic build and current root HTML');
  // A source checkout contains no generated HTML. Copy only the build's
  // explicit inputs and use the installed build tool through a local adapter.
  const sourceFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'image-format-source-build-'));
  try {
    for (const name of new Set(first.watchFiles)) {
      const target = path.resolve(sourceFixture, name);
      assert.ok(target.startsWith(sourceFixture + path.sep));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, name), target);
    }
    const tool = path.join(sourceFixture, 'scripts/node_modules/esbuild');
    fs.mkdirSync(tool, { recursive: true });
    fs.writeFileSync(path.join(tool, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
    fs.writeFileSync(path.join(tool, 'index.mjs'), `export { build } from ${JSON.stringify(pathToFileURL(requireBuildTool.resolve('esbuild')).href)};\n`);
    const output = path.join(sourceFixture, 'image-format-lab.html');
    assert.equal(fs.existsSync(output), false, 'generated HTML is absent from the source checkout');
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: sourceFixture, stdio: 'pipe' });
    const fresh = fs.readFileSync(output, 'utf8');
    const expected = tag ? (await buildViewer()).html : first.html;
    assert.equal(fresh, expected, 'a fresh checkout builds the same local HTML');
    execFileSync(process.execPath, ['scripts/build.mjs', '--check'], { cwd: sourceFixture, stdio: 'pipe' });
  } finally {
    const resolved = fs.realpathSync(sourceFixture);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('image-format-source-build-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log('PASS source-only checkout builds the root HTML without a pre-existing output');
  // Model Git/editor line-ending conversion only for the explicitly embedded
  // project texts. No files are changed, and vendor bytes are never converted.
  const embeddedTextPaths = new Set(['src/index.html', 'src/styles.css', 'src/icons.svg', 'src/favicon.svg',
    'LICENSE', 'NOTICE.md', 'ASSETS.md', 'docs/licenses/acorn-LICENSE', 'docs/licenses/esbuild-LICENSE']
    .map(name => path.join(root, name)));
  const originalRead = fs.readFileSync;
  try {
    for (const ending of ['\n', '\r\n']) {
      const converted = new Set();
      fs.readFileSync = function (file, ...args) {
        const content = originalRead.call(this, file, ...args);
        if (typeof file !== 'string' || typeof content !== 'string' || !embeddedTextPaths.has(path.resolve(file))) return content;
        converted.add(path.resolve(file));
        return content.replace(/\r\n?/g, '\n').replace(/\n/g, ending);
      };
      const convertedBuild = await buildViewer(options);
      assert.deepEqual(converted, embeddedTextPaths, 'exercise all directly embedded project texts');
      assert.equal(convertedBuild.sha256, first.sha256, 'Git/editor LF or CRLF must not change HTML bytes');
    }
  } finally { fs.readFileSync = originalRead; }
  console.log('PASS identical HTML for LF and CRLF project texts (in-memory inputs; vendor unchanged)');
  const payload = JSON.parse(first.html.match(/<script type="application\/json" id="embedded-codecs">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.releaseTag, tag);
  assert.ok(first.watchFiles.includes('scripts/build-version.mjs'));
  for (const name of ['package.json', 'package-lock.json']) {
    assert.ok(first.watchFiles.includes('scripts/' + name));
    assert.ok(!first.watchFiles.includes(name));
  }
  assert.equal(Object.keys(payload.scripts).length, 7);
  assert.equal(Object.keys(payload.licenses).length, 48);
  assert.ok(!Object.keys(payload.scripts).some(name => /heic2any|gifshot/.test(name)));
  assert.equal(payload.scripts['vendor/UTIF-3.1.0.js'], fs.readFileSync(path.join(root,'vendor/sources/utif/UTIF.js'),'utf8'));
  assert.ok(!/UTIF\.(?:JpegDecoder|LosslessJpegDecode)\s*=|PDFJS\.JpegImage/.test(payload.scripts['vendor/UTIF-3.1.0.js']));
  assert.ok(payload.licenses['JPEG-NOTICE'].includes('Independent JPEG Group'));
  assert.ok(!Object.hasOwn(payload, 'sources') && !Object.hasOwn(payload, 'sourceArchives'));
  assert.deepEqual(Object.keys(payload.sourcePackages).sort(), ['gifenc', 'heic']);
  assert.equal(Object.values(payload.scripts).filter(entry => entry?.encoding === 'gzip-base64').length, 3);
  for (const entry of Object.values(payload.scripts)) if (entry?.encoding === 'gzip-base64') {
    assert.equal(Buffer.from(entry.data, 'base64')[9], 255, 'gzip OS must be platform-neutral for Windows/Linux build parity');
  }
  for (const [name, source] of Object.entries(payload.scripts)) assert.equal(decodeScript(source), fs.readFileSync(path.join(root, name), 'utf8'));
  for (const [name, license] of Object.entries(payload.licenses)) assert.equal(license, fs.readFileSync(path.join(root, 'vendor', name), 'utf8'));
  const notices = JSON.parse(first.html.match(/<script type="application\/json" id="embedded-notices">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(Object.keys(notices).sort(), ['ASSETS.md', 'LICENSE', 'NOTICE.md', 'docs/licenses/acorn-LICENSE', 'docs/licenses/esbuild-LICENSE']);
  for (const [name, notice] of Object.entries(notices)) assert.equal(notice, fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n?/g, '\n'));
  assert.ok(notices.LICENSE.includes('Copyright (c) 2026 Ilya Barilo'));
  assert.deepEqual(payload.components, JSON.parse(fs.readFileSync(path.join(root, 'vendor/components.json'), 'utf8')));
  const { sourceNames } = require('../scripts/vendor-files.cjs');
  for (const name of sourceNames) assert.ok(first.watchFiles.includes('vendor/' + name));
  const { buildGifenc } = require('../vendor/sources/gifenc-1.0.3/build.cjs');
  const expectedGifenc = fs.readFileSync(path.join(root, 'vendor/gifenc-1.0.3.cjs'), 'utf8');
  assert.equal(buildGifenc({ buildSync: requireBuildTool('esbuild').buildSync }), expectedGifenc, 'the shipped gifenc must be reproducible from the supplied source package');
  // No root node_modules in this fixture: an old local installation must not
  // conceal missing dependency resolution after npm moved into scripts/.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'image-format-gifenc-build-'));
  try {
    const sourceDir = path.join(fixture, 'vendor/sources/gifenc-1.0.3');
    for (const name of sourceNames) {
      const target = path.join(fixture, 'vendor', name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, 'vendor', name), target);
    }
    const tool = path.join(fixture, 'scripts/node_modules/esbuild');
    fs.mkdirSync(tool, { recursive: true });
    fs.writeFileSync(path.join(tool, 'index.js'), `module.exports = require(${JSON.stringify(requireBuildTool.resolve('esbuild'))});\n`);
    const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
    const projectBuild = `const { buildSync } = require('./node_modules/esbuild');
process.stdout.write(require('../vendor/sources/gifenc-1.0.3/build.cjs').buildGifenc({ buildSync }));`;
    assert.equal(execFileSync(process.execPath, ['--eval', projectBuild], { cwd: path.join(fixture, 'scripts'), env, encoding: 'utf8' }), expectedGifenc);
    // The separately distributed source package must still build after its
    // own npm installation, without depending on the parent application's layout.
    const standaloneTool = path.join(sourceDir, 'node_modules/esbuild');
    fs.mkdirSync(standaloneTool, { recursive: true });
    fs.copyFileSync(path.join(tool, 'index.js'), path.join(standaloneTool, 'index.js'));
    execFileSync(process.execPath, ['build.cjs'], { cwd: sourceDir, env, stdio: 'pipe' });
    assert.equal(fs.readFileSync(path.join(sourceDir, 'gifenc.cjs'), 'utf8'), expectedGifenc);
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), fixture);
    assert.ok(relative.startsWith('image-format-gifenc-build-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log('PASS gifenc build with scripts-only dependencies and standalone source package');
  console.log('PASS exact vendor texts and complete project notices with normalized line endings');
  const bundle = first.html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tree = parse(bundle, { ecmaVersion: 'latest' });
  function walk(node, fn) { fn(node); for (const value of Object.values(node)) if (Array.isArray(value)) { for (const item of value) if (item?.type) walk(item, fn); } else if (value?.type) walk(value, fn); }
  walk(tree, n => assert.ok(!['ImportDeclaration', 'ImportExpression'].includes(n.type), 'release must not import runtime files'));
  const themeBundle = first.html.match(/<script id="viewer-theme">([\s\S]*?)<\/script>/)[1];
  walk(parse(themeBundle, { ecmaVersion: 'latest' }), n => assert.ok(!['ImportDeclaration', 'ImportExpression'].includes(n.type), 'theme startup must be standalone'));
  for (const name of ['src/theme-startup.mjs', 'src/ui/theme.mjs']) assert.ok(first.watchFiles.includes(name));
  assert.ok(!bundle.includes('sourceParameter'), 'test bridge must be absent');
  assert.ok(!first.inputs.some(n => n.startsWith('tests/')));
  console.log('PASS standalone script without runtime imports or test instrumentation');
  const graph = new Map();
  for (const name of first.inputs) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    graph.set(name, tree.body.filter(n => n.type === 'ImportDeclaration' && n.source.value.startsWith('.')).map(n => path.posix.normalize(path.posix.join(path.posix.dirname(name), n.source.value))));
    if (name.startsWith('src/core/')) assert.ok(!/\b(?:app|els)\./.test(source), name + ' must not read UI state');
  }
  function visit(name, stack = new Set(), done = new Set()) {
    assert.ok(!stack.has(name), 'cyclic import: ' + [...stack, name].join(' -> '));
    if (done.has(name)) return;
    assert.ok(graph.has(name), 'dependency missing from build: ' + name);
    stack.add(name); for (const dep of graph.get(name)) visit(dep, stack, done); stack.delete(name); done.add(name);
  }
  for (const name of graph.keys()) visit(name);
  console.log('PASS acyclic ES-module graph; core algorithms are independent of application state');
})().catch(error => { console.error(error); process.exitCode = 1; });
