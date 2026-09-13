// Node-only release plumbing tests. GitHub and browser responses are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

(async () => {
  const { githubSourceConfig } = await import('../scripts/source-release.mjs');
  const { checkTrackedPaths, checkRepository } = await import('../scripts/check-repository.mjs');
  const repository = 'Example/image-format-lab', tag = 'v1.2.3';
  assert.equal(githubSourceConfig(repository, 'v1.2.3+build.4').urls.heic, 'https://github.com/Example/image-format-lab/releases/download/v1.2.3%2Bbuild.4/heic-sources.zip');
  for (const name of ['../escape', 'https://github.com/a/b', 'a/b/c', 'a/..', 'a/b?x', 'a/b#x']) assert.throws(() => githubSourceConfig(name, tag), /owner\/name/);
  assert.throws(() => githubSourceConfig(repository, 'latest'), /explicit version tag/);
  assert.equal(githubSourceConfig(repository, 'v0.1').urls.heic, 'https://github.com/Example/image-format-lab/releases/download/v0.1/heic-sources.zip');
  checkTrackedPaths(['src/main.mjs', 'vendor/heic-sources.zip', '.github/workflows/ci.yml']);
  for (const name of ['local/arh/never-read.zip', 'AGENTS.md', '.gitignore', 'debug.log', 'photo/image.jpg', 'node_modules/test.js', 'scripts/node_modules/acorn/dist/acorn.js', 'docs/ARTICLE_SOURCE_MESSAGES.md']) assert.throws(() => checkTrackedPaths([name]), /Excluded paths/);

  const tempRoot = fs.realpathSync(os.tmpdir()), fixture = fs.mkdtempSync(path.join(tempRoot, 'image-format-clean-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=' + path.join(fixture, 'no-hooks'), ...args], { cwd: fixture, stdio: 'pipe' });
  try {
    git('init', '--template=', '--initial-branch=test');
    for (const name of ['image-format-lab.html', 'input.txt']) fs.writeFileSync(path.join(fixture, name), 'original');
    git('add', '--', 'input.txt');
    git('commit', '-m', 'Fixture');
    checkRepository(fixture);
    fs.writeFileSync(path.join(fixture, 'image-format-lab.html'), 'built');
    checkRepository(fixture); // Rebuilding the untracked output is allowed.
    git('add', '--', 'image-format-lab.html');
    assert.throws(() => checkRepository(fixture), /Excluded paths/);
    git('rm', '--cached', '--', 'image-format-lab.html');
    fs.writeFileSync(path.join(fixture, 'input.txt'), 'modified');
    git('add', '--', 'input.txt');
    assert.throws(() => checkRepository(fixture), /inputs have changed/);
  } finally {
    const resolved = fs.realpathSync(fixture);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('image-format-clean-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log('PASS exact tag URLs, excluded path names and clean tracked inputs (temporary Git only)');

})().catch(error => { console.error(error); process.exitCode = 1; });
