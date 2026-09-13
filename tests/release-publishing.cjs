// Release requests are simulated; this suite starts neither Git nor a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const { githubSourceConfig } = await import('../scripts/source-release.mjs');
  const { verifyReleaseCheckout } = await import('../scripts/build-version.mjs');
  const { assetNames, checksumName, checksumText, sha256, validateAssets, validateBrowserReport } = await import('../scripts/release-assets.mjs');
  const { publishRelease } = await import('../scripts/publish-release.mjs');
  const repository = 'Example/image-format-lab', tag = 'v1.2.3', commit = 'a'.repeat(40), releaseId = 17;
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /on:\n  release:\n    types: \[published\]/);
  assert.match(workflow, /if: startsWith\(github\.event\.release\.tag_name, 'v'\)/);
  assert.doesNotMatch(workflow, /workflow_dispatch|inputs\.tag/);
  assert.match(workflow, /RELEASE_ID: \$\{\{ github\.event\.release\.id \}\}/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: refs\/tags\//);
  assert.match(workflow, /verifyReleaseCheckout\(process\.env\.RELEASE_TAG, process\.cwd\(\)\)/);
  assert.ok(workflow.indexOf('verifyReleaseCheckout(') < workflow.indexOf('uses: ./.github/actions/setup-tests'));
  assert.match(workflow, /publish:\n    needs: build/);
  const checks = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(checks, /on:\n  push:/);
  assert.doesNotMatch(checks, /workflow_dispatch/);
  function checkout({ wrongHead = false, outsideMain = false, missingMain = false } = {}) {
    const calls = [];
    const runGit = args => {
      calls.push(args);
      if (args[0] === 'rev-parse') {
        const ref = args[2];
        if (ref.includes('main')) { if (missingMain) throw new Error('missing'); return 'b'.repeat(40); }
        return wrongHead && ref === 'HEAD^{commit}' ? 'c'.repeat(40) : commit;
      }
      assert.deepEqual(args, ['merge-base', '--is-ancestor', commit, 'b'.repeat(40)]);
      if (outsideMain) throw new Error('outside main');
      return '';
    };
    verifyReleaseCheckout(tag, root, { runGit });
    return calls;
  }
  assert.equal(checkout().length, 4);
  assert.throws(() => checkout({ wrongHead: true }), /does not match HEAD/);
  assert.throws(() => checkout({ outsideMain: true }), /does not belong to main/);
  assert.throws(() => checkout({ missingMain: true }), /main branch history/);
  for (const invalid of ['v', 'v-anything', 'V1', 'v01', 'v0.1.2.3.4']) {
    let gitCalled = false;
    assert.throws(() => verifyReleaseCheckout(invalid, root, { runGit() { gitCalled = true; throw new Error('unexpected'); } }), /explicit version tag/);
    assert.equal(gitCalled, false);
  }
  console.log('PASS automatic release event, v-prefix gate and exact tag from main (simulated Git calls)');

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


  async function simulate(input = {}) {
    const { selectedTag = tag, existingCount = 0, mismatchExisting = false, badExistingState = false, duplicate = false,
      moved = false, moveDuringUpload = false, lightweight = false, immutable = false, draft = false,
      wrongRelease = false, wrongTag = false, missingRelease = false, badId = false,
      corruptUpload = false, failUploadAt = 0, failPublic = false, transientPublic = false,
      prerelease = false, latest = true, latestMissing = false, missingToken = false } = input;
    const currentFiles = candidate(selectedTag), calls = [], uploaded = new Map(), listed = [];
    const metadata = { id: releaseId, tag_name: selectedTag, draft, immutable, prerelease, name: 'Название автора', body: 'Описание автора' };
    for (const [name, bytes] of [...currentFiles].slice(0, existingCount)) {
      const id = 100 + listed.length;
      const content = mismatchExisting ? Buffer.alloc(bytes.length) : bytes;
      uploaded.set(id, content);
      listed.push({ id, name, size: bytes.length, state: badExistingState ? 'starter' : 'uploaded' });
    }
    if (duplicate && listed.length) listed.push({ ...listed[0], id: 199 });
    // Additional user attachments must be left alone.
    listed.push({ id: 999, name: 'user-notes.txt', size: 5, state: 'uploaded' });
    let publicReads = 0, nextId = 10, posts = 0;
    const request = async (url, options = {}) => {
      const method = options.method || 'GET'; calls.push({ url, method });
      const json = value => new Response(JSON.stringify(value), { status: 200 });
      assert.ok(['GET', 'POST'].includes(method), 'must not edit or delete releases or assets');
      if (url.startsWith('https://api.github.com/') || url.startsWith('https://uploads.github.com/')) assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (url.endsWith('/releases/' + releaseId)) {
        assert.equal(method, 'GET', 'existing release metadata is read-only');
        if (missingRelease) return new Response('missing', { status: 404 });
        return json({ ...metadata, id: wrongRelease ? releaseId + 1 : releaseId, tag_name: wrongTag ? 'v9' : selectedTag });
      }
      if (url.includes('/git/ref/tags/')) return json({ object: { type: lightweight ? 'commit' : 'tag', sha: lightweight ? ((moved || (moveDuringUpload && posts)) ? 'c'.repeat(40) : commit) : 'b'.repeat(40) } });
      if (url.includes('/git/tags/')) return json({ object: { type: 'commit', sha: (moved || (moveDuringUpload && posts)) ? 'c'.repeat(40) : commit } });
      if (method === 'GET' && url.includes('/releases/' + releaseId + '/assets?')) return json(listed);
      if (method === 'POST' && url.startsWith('https://uploads.github.com/')) {
        assert.ok(url.includes('/releases/' + releaseId + '/assets?'), 'upload only to event release ID');
        posts++;
        if (posts === failUploadAt) return new Response('failed', { status: 503 });
        const name = new URL(url).searchParams.get('name'), id = nextId++;
        uploaded.set(id, options.body);
        return json({ id, name, size: options.body.length, state: 'uploaded' });
      }
      if (method === 'GET' && url.includes('/releases/assets/')) {
        const id = Number(url.split('/').at(-1));
        assert.notEqual(id, 999, 'unrelated user attachment must not be downloaded');
        return new Response(corruptUpload && id < 100 ? Buffer.from('wrong') : uploaded.get(id));
      }
      if (url.endsWith('/releases/latest')) return latestMissing ? new Response('missing', { status: 404 }) : json({ id: latest ? releaseId : 91 });
      if (url.startsWith('https://github.com/')) {
        assert.equal(options.headers.Authorization, undefined, 'public downloads must not use a token');
        publicReads++;
        if (failPublic || (transientPublic && publicReads === 1)) return new Response('unavailable', { status: 503 });
        return new Response(currentFiles.get(decodeURIComponent(url.split('/').at(-1))));
      }
      throw new Error('Unexpected request: ' + url);
    };
    let result, error;
    try { result = await publishRelease(currentFiles, { repository, tag: selectedTag, commit, releaseId: badId ? 0 : releaseId, token: missingToken ? '' : 'test-token', request, sleep: async () => {} }); }
    catch (caught) { error = caught; }
    assert.equal(metadata.name, 'Название автора');
    assert.equal(metadata.body, 'Описание автора');
    return { result, error, calls, posts };
  }
  const stable = await simulate({ transientPublic: true });
  assert.equal(stable.error, undefined);
  assert.equal(stable.posts, 4);
  assert.ok(stable.calls.filter(call => call.method === 'POST').at(-1).url.endsWith('name=image-format-lab.html'), 'source kits must be available before the HTML upload');
  assert.equal(stable.result.prerelease, false);
  assert.equal(stable.result.latest, true);
  assert.ok(stable.calls.some(call => call.url.includes('/latest/download/')));
  assert.equal(stable.calls.filter(call => call.url.includes('/releases/assets/')).length, 4);
  for (const selectedTag of ['v1', 'v0.1', 'v0.1.0', 'v0.1.2.3']) {
    const release = await simulate({ selectedTag, lightweight: true });
    assert.equal(release.error, undefined);
    assert.equal(release.result.tag, selectedTag);
    assert.ok(release.calls.some(call => call.url.includes('/releases/download/' + selectedTag + '/')));
  }
  for (const selectedTag of ['1.2.3', '0.1']) {
    const release = await simulate({ selectedTag });
    assert.match(release.error.message, /must start with v/);
    assert.equal(release.calls.length, 0);
  }
  const pre = await simulate({ selectedTag: 'v1.3.0-rc.1', prerelease: true, latestMissing: true });
  assert.equal(pre.error, undefined);
  assert.equal(pre.result.prerelease, true);
  assert.equal(pre.result.latest, false);
  assert.ok(!pre.calls.some(call => call.url.includes('/latest/download/')));
  const userPre = await simulate({ prerelease: true, latest: false });
  assert.equal(userPre.error, undefined);
  assert.equal(userPre.result.prerelease, true, 'respect author choice even for a numeric tag');
  const oldStable = await simulate({ latest: false });
  assert.equal(oldStable.error, undefined);
  assert.ok(!oldStable.calls.some(call => call.url.includes('/latest/download/')));
  for (const existingCount of [1, 4]) {
    const retry = await simulate({ existingCount });
    assert.equal(retry.error, undefined);
    assert.equal(retry.posts, 4 - existingCount);
  }
  for (const input of [{ moved: true }, { immutable: true }, { draft: true }, { wrongRelease: true },
    { wrongTag: true }, { missingRelease: true }, { badId: true }, { missingToken: true },
    { existingCount: 1, mismatchExisting: true }, { existingCount: 1, badExistingState: true }, { existingCount: 1, duplicate: true }]) {
    const failed = await simulate(input);
    assert.ok(failed.error, JSON.stringify(input));
    assert.equal(failed.posts, 0, 'validation must finish before any upload: ' + JSON.stringify(input));
  }
  for (const input of [{ corruptUpload: true }, { failUploadAt: 2 }, { moveDuringUpload: true }, { failPublic: true }]) {
    const failed = await simulate(input);
    assert.ok(failed.error);
    assert.match(failed.error.message, /Nothing was deleted or overwritten/);
    assert.ok(!failed.calls.some(call => ['PATCH', 'DELETE'].includes(call.method)));
    if (input.moveDuringUpload) assert.equal(failed.posts, 1);
  }
  console.log('PASS existing release ID, metadata/Latest preservation, exact bytes, anonymous downloads, retry, conflicts, moved tags and upload failures (simulated API only)');
})().catch(error => { console.error(error); process.exitCode = 1; });
