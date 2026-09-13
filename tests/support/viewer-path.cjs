const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
let built;
module.exports = function viewerPath(file = 'image-format-lab.html') {
  if (file !== 'image-format-lab.html') return path.join(root, file);
  if (!built) {
    built = path.join(os.tmpdir(), 'viewer-modular-test-' + crypto.randomUUID() + '.html');
    execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--test', '--output=' + built], { cwd: root, stdio: 'pipe' });
    process.once('exit', () => { if (fs.existsSync(built)) fs.unlinkSync(built); });
  }
  return built;
};
