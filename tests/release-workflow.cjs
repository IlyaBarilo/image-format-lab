// Node-only release plumbing tests. GitHub and browser responses are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

(async () => {
  const { githubSourceConfig } = await import('../scripts/source-release.mjs');
  const { checkTrackedPaths, checkRepository } = await import('../scripts/check-repository.mjs');
  const { assetNames, checksumName, checksumText, sha256, validateAssets, validateBrowserReport } = await import('../scripts/release-assets.mjs');
  const { publishRelease } = await import('../scripts/publish-release.mjs');
  const repository = 'Example/image-format-lab', tag = 'v1.2.3', commit = 'a'.repeat(40);
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
    git('add', '--', 'image-format-lab.html', 'input.txt');
    git('commit', '-m', 'Fixture');
    checkRepository(fixture);
    fs.writeFileSync(path.join(fixture, 'image-format-lab.html'), 'built');
    assert.throws(() => checkRepository(fixture), /inputs have changed/);
    checkRepository(fixture, { allowBuiltHtml: true });
    fs.writeFileSync(path.join(fixture, 'input.txt'), 'modified');
    git('add', '--', 'input.txt');
    assert.throws(() => checkRepository(fixture, { allowBuiltHtml: true }), /inputs have changed/);
  } finally {
    const resolved = fs.realpathSync(fixture);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('image-format-clean-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log('PASS exact tag URLs, excluded path names and clean tracked inputs (temporary Git only)');

  const originalHtml = fs.readFileSync(path.join(root, assetNames[0]), 'utf8');
  function candidate(selectedTag = tag) {
    const config = githubSourceConfig(repository, selectedTag);
    const payload = JSON.parse(originalHtml.match(/id="embedded-codecs">([\s\S]*?)<\/script>/)[1]);
    payload.releaseTag = selectedTag;
    for (const id of ['gifenc', 'heic']) payload.sourcePackages[id].url = config.urls[id];
    const html = originalHtml.replace(/(id="embedded-codecs">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(payload).replace(/</g, '\\u003c') + b);
    const files = new Map(assetNames.map((name, i) => [name, i ? fs.readFileSync(path.join(root, 'vendor', name)) : Buffer.from(html)]));
    files.set(checksumName, Buffer.from(checksumText(files)));
    return files;
  }
  const files = candidate();
  validateAssets(files, repository, tag);
  assert.throws(() => validateAssets(files, repository, 'v1.2.4'), /different release/);
  assert.throws(() => validateAssets(files, 'Another/repo', tag), /source URL/);
  const corrupt = new Map(files); corrupt.set(assetNames[2], Buffer.from('corrupt'));
  assert.throws(() => validateAssets(corrupt, repository, tag), /checksums/);
  corrupt.set(checksumName, Buffer.from(checksumText(corrupt)));
  assert.throws(() => validateAssets(corrupt, repository, tag), /manifest/);
  assert.throws(() => validateAssets(new Map([...files, ['extra.html', Buffer.from('extra')]]), repository, tag), /asset set/);
  // A report fixture only, never written or passed to the real package command.
  const report = { passed: true, publicHtml: assetNames[0], bytes: files.get(assetNames[0]).length, sha256: sha256(files.get(assetNames[0])), checks: ['simulated'], externalRequests: [], errors: [] };
  validateBrowserReport(report, files.get(assetNames[0]));
  for (const change of [{ passed: false }, { sha256: '0'.repeat(64) }, { checks: [] }, { errors: ['error'] }, { externalRequests: ['https://example.invalid'] }]) assert.throws(() => validateBrowserReport({ ...report, ...change }, files.get(assetNames[0])), /browser report/);
  console.log('PASS release asset bytes/URLs/checksums and exact successful offline report requirement (simulated report)');

  async function simulate({ selectedTag = tag, existing = false, moved = false, corruptUpload = false, failPublic = false, transientPublic = false } = {}) {
    const currentFiles = candidate(selectedTag), calls = [], uploaded = new Map();
    let publicReads = 0, nextId = 10;
    const request = async (url, options = {}) => {
      const method = options.method || 'GET'; calls.push({ url, method, options });
      const json = value => new Response(JSON.stringify(value), { status: 200 });
      if (url.includes('/releases?per_page=')) return json(existing ? [{ tag_name: selectedTag, draft: true }] : []);
      if (url.includes('/git/ref/tags/')) return json({ object: { type: 'tag', sha: 'b'.repeat(40) } });
      if (url.includes('/git/tags/')) return json({ object: { type: 'commit', sha: moved ? 'c'.repeat(40) : commit } });
      if (method === 'POST' && url.endsWith('/releases')) return json({ id: 1 });
      if (method === 'POST' && url.startsWith('https://uploads.github.com/')) {
        const name = new URL(url).searchParams.get('name'), id = nextId++;
        uploaded.set(id, options.body);
        return json({ id, name, size: options.body.length, state: 'uploaded' });
      }
      if (method === 'GET' && url.includes('/releases/assets/')) {
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        return new Response(corruptUpload ? Buffer.from('wrong') : uploaded.get(Number(url.split('/').at(-1))));
      }
      if (method === 'PATCH') return json({ id: 1, draft: false });
      if (url.startsWith('https://github.com/')) {
        assert.equal(options.headers.Authorization, undefined, 'public checks must not use a token');
        publicReads++;
        if (failPublic || (transientPublic && publicReads === 1)) return new Response('unavailable', { status: 503 });
        return new Response(currentFiles.get(decodeURIComponent(url.split('/').at(-1))));
      }
      throw new Error('Unexpected request: ' + url);
    };
    let result, error;
    try { result = await publishRelease(currentFiles, { repository, tag: selectedTag, commit, token: 'test-token', request, sleep: async () => {} }); }
    catch (caught) { error = caught; }
    return { result, error, calls };
  }
  const stable = await simulate({ transientPublic: true });
  assert.equal(stable.error, undefined);
  assert.equal(stable.result.prerelease, false);
  assert.ok(stable.calls.find(call => call.url.includes('/latest/download/')));
  assert.equal(JSON.parse(stable.calls.find(call => call.method === 'PATCH').options.body).make_latest, 'true');
  const patchIndex = stable.calls.findIndex(call => call.method === 'PATCH');
  assert.equal(stable.calls.slice(0, patchIndex).filter(call => call.url.includes('/releases/assets/')).length, 4);
  for (const selectedTag of ['v1', 'v0.1', 'v0.1.0', 'v0.1.2.3']) {
    const short = await simulate({ selectedTag });
    assert.equal(short.error, undefined);
    assert.equal(short.result.tag, selectedTag);
    assert.equal(short.result.prerelease, false);
    assert.ok(short.calls.some(call => call.url.includes(`/releases/download/${selectedTag}/`)));
    assert.ok(short.calls.some(call => call.url.includes('/latest/download/')));
    assert.equal(JSON.parse(short.calls.find(call => call.method === 'POST' && call.url.endsWith('/releases')).options.body).tag_name, selectedTag);
    assert.equal(JSON.parse(short.calls.find(call => call.method === 'PATCH').options.body).make_latest, 'true');
  }
  const pre = await simulate({ selectedTag: 'v1.3.0-rc.1' });
  assert.equal(pre.error, undefined); assert.equal(pre.result.prerelease, true);
  assert.ok(!pre.calls.some(call => call.url.includes('/latest/download/')));
  assert.equal(JSON.parse(pre.calls.find(call => call.method === 'PATCH').options.body).make_latest, 'false');
  for (const input of [{ existing: true }, { moved: true }, { corruptUpload: true }]) {
    const failed = await simulate(input);
    assert.ok(failed.error);
    assert.ok(!failed.calls.some(call => call.method === 'PATCH' || call.method === 'DELETE'));
    if (!input.corruptUpload) assert.ok(!failed.calls.some(call => call.method === 'POST'));
  }
  const unavailable = await simulate({ failPublic: true });
  assert.match(unavailable.error.message, /publication was confirmed/);
  assert.ok(!unavailable.calls.some(call => call.method === 'DELETE'));
  console.log('PASS simulated GitHub: stable/prerelease, draft uploads verified before publication, anonymous download/retry, existing release, moved tag and failure preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
