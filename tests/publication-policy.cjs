const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { folder } = require('./support/artifacts.cjs');

(async () => {
  const { checkTrackedPaths, checkRepository } = await import('../scripts/check-repository.mjs');
  checkTrackedPaths(['README.md', 'src/main.mjs', 'docs/USAGE.md', 'vendor/HEIC-NOTICE']);
  for (const name of [
    'local/private.md', 'AGENTS.md', '.gitignore', 'image-format-lab.html',
    'docs/verification/report.md', 'docs/verification/nested/screenshot.png',
    'docs/ARTICLE_SOURCE_MESSAGES.md', 'docs/ANALYSIS_PLAN.md', 'docs/REPOSITORY.md',
    'test-results/run.txt', 'scripts/node_modules/package/index.js'
  ]) assert.throws(() => checkTrackedPaths([name]), /Excluded paths/);

  const root = path.resolve(__dirname, '..');
  const calls = [];
  const verify = (tracked, changed = []) => checkRepository(root, { runGit(args) {
    calls.push(args[0]);
    return (args[0] === 'ls-files' ? tracked : changed).join('\0');
  } });
  verify(['src/index.html', 'vendor/manifest.json']);
  assert.throws(() => verify(['src/index.html'], ['src/index.html']), /inputs have changed/);
  calls.length = 0;
  assert.throws(() => verify(['image-format-lab.html']), /Excluded paths/);
  assert.deepEqual(calls, ['ls-files'], 'reject tracked output before inspecting changes');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const release = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  for (const [workflow, build] of [[ci, 'npm --prefix scripts run build\n'], [release, 'npm --prefix scripts run build:release --']]) {
    const text = workflow.replace(/\r\n/g, '\n');
    assert.ok(text.indexOf(build) > text.indexOf('node scripts/check-repository.mjs'), 'validate tracked inputs before building');
    assert.ok(text.indexOf(build) < text.indexOf('run: npm --prefix scripts test'), 'build before tests in a checkout without HTML');
    assert.ok(text.indexOf(' --check') > text.indexOf('run: npm --prefix scripts test'), 'verify generated HTML after tests');
  }
  for (const name of ['local/test-results', 'local/test-results/run', 'test-results/ci']) {
    assert.equal(folder(name), path.resolve(root, name));
  }
  for (const name of ['local', 'local/private', 'local/test-results/../private',
    'local/test-results-extra', 'docs/verification', 'src', '../test-results']) {
    assert.throws(() => folder(name), /Test output must/);
  }
  console.log('PASS publication exclusions and output boundaries without reading excluded paths');
})().catch(error => { console.error(error); process.exitCode = 1; });
