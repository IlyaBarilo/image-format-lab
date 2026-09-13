import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readAssets, validateAssets, sha256 } from './release-assets.mjs';

export async function publishRelease(files, { repository, tag, commit, releaseId, token, request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  validateAssets(files, repository, tag);
  if (!tag.startsWith('v')) throw new Error('Release tags must start with v');
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit || '')) throw new Error('Expected the tested commit SHA');
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error('Expected the release event ID');
  if (!token) throw new Error('GH_TOKEN is required');
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api(method, url, body, { binary = false, optional = false } = {}) {
    const response = await request(url, { method, headers: { ...headers, ...(body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) }, body: body ? (binary ? body : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(30000) });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} failed (${response.status})`);
    return response.json();
  }
  async function verifyDownload(url, bytes, authenticated = false) {
    const response = await request(url, { headers: authenticated ? { ...headers, Accept: 'application/octet-stream' } : {}, signal: AbortSignal.timeout(30000) });
    if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== sha256(bytes)) throw new Error('Download failed or differs from the tested asset: ' + url);
  }
  async function boundRelease() {
    const release = await api('GET', `${base}/releases/${releaseId}`);
    if (release.id !== releaseId || release.tag_name !== tag || release.draft !== false || typeof release.prerelease !== 'boolean') throw new Error('Release event no longer matches a published release: ' + tag);
    if (release.immutable === true) throw new Error('Published immutable releases cannot accept assets');
    let ref = (await api('GET', `${base}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
    for (let depth = 0; ref?.type === 'tag' && depth < 5; depth++) ref = (await api('GET', `${base}/git/tags/${ref.sha}`)).object;
    if (ref?.type !== 'commit' || ref.sha !== commit) throw new Error('Remote tag no longer matches the tested commit');
    return release;
  }
  function validAsset(asset, name, bytes) {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.name !== name || asset.size !== bytes.length || asset.state !== 'uploaded') throw new Error('Incomplete or conflicting asset: ' + name);
  }
  await boundRelease();
  const existing = new Map();
  for (let page = 1; ; page++) {
    if (page > 20) throw new Error('Too many assets to check safely');
    const assets = await api('GET', `${base}/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(assets)) throw new Error('Invalid release asset list');
    for (const asset of assets) {
      if (!files.has(asset.name)) continue;
      if (existing.has(asset.name)) throw new Error('Duplicate release asset: ' + asset.name);
      existing.set(asset.name, asset);
    }
    if (assets.length < 100) break;
  }
  // Validate all existing names before uploading. Retries reuse only identical
  // bytes; additional user assets and release metadata remain under user control.
  for (const [name, asset] of existing) {
    const bytes = files.get(name);
    validAsset(asset, name, bytes);
    await verifyDownload(`${base}/releases/assets/${asset.id}`, bytes, true);
  }
  const downloadBase = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/`;
  try {
    // Make the corresponding sources available before the application download.
    const uploads = [...files].sort(([a], [b]) => Number(a === 'image-format-lab.html') - Number(b === 'image-format-lab.html'));
    for (const [name, bytes] of uploads) {
      if (existing.has(name)) continue;
      await boundRelease();
      const asset = await api('POST', `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, bytes, { binary: true });
      validAsset(asset, name, bytes);
      await verifyDownload(`${base}/releases/assets/${asset.id}`, bytes, true);
    }
    const release = await boundRelease();
    const latest = await api('GET', `${base}/releases/latest`, undefined, { optional: true });
    const isLatest = latest?.id === releaseId;
    const downloads = [...files].map(([name, bytes]) => [downloadBase + name, bytes]);
    if (isLatest) downloads.push([`https://github.com/${repository}/releases/latest/download/image-format-lab.html`, files.get('image-format-lab.html')]);
    for (const [url, bytes] of downloads) {
      for (let attempt = 0; ; attempt++) {
        try { await verifyDownload(url, bytes); break; }
        catch (error) { if (attempt === 4) throw error; await sleep(3000); }
      }
    }
    return { tag, releaseId, prerelease: release.prerelease, latest: isLatest, url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}` };
  } catch (error) {
    throw new Error(`${tag}: inspect the existing release and uploaded assets. Nothing was deleted or overwritten. ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  publishRelease(readAssets(path.join(root, 'dist/release')), { repository: process.env.GITHUB_REPOSITORY, tag: process.env.RELEASE_TAG, commit: process.env.RELEASE_COMMIT, releaseId: Number(process.env.RELEASE_ID), token: process.env.GH_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
