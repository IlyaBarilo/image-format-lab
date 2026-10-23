const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sharedViewer(env = process.env) {
  const file = env.IMAGE_TEST_VIEWER_HTML, digest = env.IMAGE_TEST_VIEWER_SHA256;
  if (!file && !digest) return null;
  if (!file || !path.isAbsolute(file) || !/\.html$/i.test(file) || !/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('Invalid shared test HTML path/hash');
  const bytes = fs.readFileSync(file);
  if (hash(bytes) !== digest || !bytes.includes(Buffer.from('holdComparisonRendering'))) throw new Error('Shared test HTML integrity/instrumentation mismatch');
  return file;
}
function prepareSharedViewer() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-test-run-'));
  const file = path.join(directory, 'instrumented.html');
  const cleanup = () => {
    // Only the two explicitly created paths, never a recursive directory walk.
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  };
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--test', '--output=' + file], {cwd:root, stdio:'pipe', timeout:120000});
    const env = {IMAGE_TEST_VIEWER_HTML:file, IMAGE_TEST_VIEWER_SHA256:hash(fs.readFileSync(file))};
    sharedViewer(env);
    return {env, cleanup};
  } catch (error) { cleanup(); throw error; }
}
module.exports = {sharedViewer, prepareSharedViewer};
