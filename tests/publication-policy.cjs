const assert = require('node:assert/strict');
const path = require('node:path');
const { folder } = require('./support/artifacts.cjs');

(async () => {
  const { checkTrackedPaths } = await import('../scripts/check-repository.mjs');
  checkTrackedPaths(['README.md', 'src/main.mjs', 'docs/USAGE.md', 'vendor/HEIC-NOTICE']);
  for (const name of [
    'local/private.md', 'AGENTS.md', '.gitignore',
    'docs/verification/report.md', 'docs/verification/nested/screenshot.png',
    'docs/ARTICLE_SOURCE_MESSAGES.md', 'docs/ANALYSIS_PLAN.md', 'docs/REPOSITORY.md',
    'test-results/run.txt', 'scripts/node_modules/package/index.js'
  ]) assert.throws(() => checkTrackedPaths([name]), /Excluded paths/);

  const root = path.resolve(__dirname, '..');
  for (const name of ['local/test-results', 'local/test-results/run', 'test-results/ci']) {
    assert.equal(folder(name), path.resolve(root, name));
  }
  for (const name of ['local', 'local/private', 'local/test-results/../private',
    'local/test-results-extra', 'docs/verification', 'src', '../test-results']) {
    assert.throws(() => folder(name), /Test output must/);
  }
  console.log('PASS publication exclusions and output boundaries without reading excluded paths');
})().catch(error => { console.error(error); process.exitCode = 1; });
