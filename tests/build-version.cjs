// Node/Git only: a disposable repository, no browser or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

(async () => {
  const { releaseVersion, verifyReleaseCheckout } = await import('../scripts/build-version.mjs');
  assert.equal(releaseVersion(), null);
  for (const tag of ['v1', '1', 'v0.1', '0.1', 'v0.1.0', 'v0.1.2.3', '0.1.2.3', 'v1.2', 'v1.2.3', '2.10.0', 'v1.0.0-rc.2', '0.1.0-beta+build.5']) {
    assert.equal(releaseVersion({ release: true, tag }), tag);
    assert.throws(() => releaseVersion({ tag }), /requires --release/);
  }
  for (const tag of [null, '', 'latest', 'HEAD', '--help', 'refs/tags/v1.2.3', 'v01', 'v1-rc.1', 'v1+build.1', 'v01.2', 'v0.01', 'v0.1-rc.1', 'v0.1+build.1', 'v0.1.2.03', 'v0.1.2.3.4', 'v0.1.2.3-rc.1', ' v0.1', 'v0.1\n', 'v0.1</script>', 'v01.2.3', 'v1.2.3-01', 'v1.2.3-', ' v1.2.3', 'v1.2.3\n', 'v1.2.3</script>']) {
    assert.throws(() => releaseVersion({ release: true, tag }), /explicit version tag/);
  }
  console.log('PASS exact short/SemVer release tag, stable/prerelease/build metadata, no local version and invalid tag rejection');

  const tempRoot = fs.realpathSync(os.tmpdir());
  const fixture = fs.mkdtempSync(path.join(tempRoot, 'image-format-version-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Build version test', '-c', 'user.email=build@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'core.hooksPath=' + path.join(fixture, 'no-hooks'), ...args], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    assert.throws(() => verifyReleaseCheckout('v1.2.3', fixture), /requires a Git checkout/);
    git('init', '--template=', '--initial-branch=main');
    git('commit', '--allow-empty', '-m', 'First fixture commit');
    git('tag', 'v1.2.3');
    git('tag', '-a', 'v0.1', '-m', 'Short release tag');
    git('tag', 'v1');
    git('tag', 'v0.1.0');
    git('tag', 'v0.1.2.3');
    git('tag', '-a', 'v1.2.3-rc.1', '-m', 'Annotated fixture tag');
    verifyReleaseCheckout('v1.2.3', fixture);
    verifyReleaseCheckout('v0.1', fixture);
    verifyReleaseCheckout('v1', fixture);
    verifyReleaseCheckout('v0.1.0', fixture);
    verifyReleaseCheckout('v0.1.2.3', fixture);
    verifyReleaseCheckout('v1.2.3-rc.1', fixture);
    git('branch', '2.0.0');
    assert.throws(() => verifyReleaseCheckout('2.0.0', fixture), /requires a Git checkout/);
    git('commit', '--allow-empty', '-m', 'Second fixture commit');
    assert.throws(() => verifyReleaseCheckout('v0.1', fixture), /does not match HEAD/);
    assert.throws(() => verifyReleaseCheckout('v1.2.3', fixture), /does not match HEAD/);
    git('checkout', '--detach', 'v1.2.3');
    verifyReleaseCheckout('v1.2.3', fixture);
    git('checkout', '-b', 'feature-only');
    git('commit', '--allow-empty', '-m', 'Outside main history');
    git('tag', 'v9.1');
    assert.throws(() => verifyReleaseCheckout('v9.1', fixture), /does not belong to main/);
    git('checkout', 'main');
    git('merge', '--no-ff', 'feature-only', '-m', 'Include release source in main');
    git('checkout', '--detach', 'v9.1');
    verifyReleaseCheckout('v9.1', fixture);
    git('branch', '-m', 'main', 'renamed-main');
    assert.throws(() => verifyReleaseCheckout('v9.1', fixture), /requires the main branch/);
    git('update-ref', 'refs/remotes/origin/main', 'renamed-main');
    verifyReleaseCheckout('v9.1', fixture);
  } finally {
    const resolved = fs.realpathSync(fixture);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('image-format-version-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log('PASS real tags and main ancestry: detached checkout, wrong commit, missing main, unmerged/merged branch and remote main');

  const root = path.resolve(__dirname, '..'), output = path.join(root, 'image-format-lab.html');
  const before = fs.readFileSync(output);
  for (const [args, message] of [
    [['--release'], /explicit version tag/],
    [['--tag=v1.2.3'], /requires --release/],
    [['--repository=Example/project'], /requires one repository and --release/],
    [['--release', '--tag=v1.2.3', '--repository=../escape'], /owner\/name/],
    [['--release', '--tag=v1.2.3', '--repository=Example/project', '--repository=Another/project'], /requires one repository/],
    [['--release', '--tag=v1.2.3', '--tag=v2.0.0'], /exactly one/],
    ...['--test', '--watch', '--debug'].map(flag => [['--release', '--tag=v1.2.3', flag], /Release cannot use/])
  ]) {
    const result = spawnSync(process.execPath, ['scripts/build.mjs', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  }
  assert.deepEqual(fs.readFileSync(output), before, 'rejected commands must retain the existing HTML');
  console.log('PASS public CLI rejects ambiguous/unsafe build modes without replacing HTML');
})().catch(error => { console.error(error); process.exitCode = 1; });
