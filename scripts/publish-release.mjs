import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readAssets, validateAssets, sha256 } from './release-assets.mjs';

export async function publishRelease(files, { repository, tag, commit, token, request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  validateAssets(files, repository, tag);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit || '')) throw new Error('Expected the tested commit SHA');
  if (!token) throw new Error('GH_TOKEN is required');
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api(method, url, body, binary = false) {
    const response = await request(url, { method, headers: { ...headers, ...(body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) }, body: body ? (binary ? body : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GitHub API ${method} failed (${response.status})`);
    return response.json();
  }
  async function verifyDownload(url, bytes, authenticated = false) {
    const response = await request(url, { headers: authenticated ? { ...headers, Accept: 'application/octet-stream' } : {}, signal: AbortSignal.timeout(30000) });
    if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== sha256(bytes)) throw new Error('Download failed or differs from the tested asset: ' + url);
  }
  // Include drafts. Never overwrite or delete an existing release or its assets.
  for (let page = 1; ; page++) {
    if (page > 20) throw new Error('Too many releases to check safely');
    const releases = await api('GET', `${base}/releases?per_page=100&page=${page}`);
    if (releases.some(release => release.tag_name === tag)) throw new Error('Release or draft already exists: ' + tag);
    if (releases.length < 100) break;
  }
  let ref = (await api('GET', `${base}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; ref?.type === 'tag' && depth < 5; depth++) ref = (await api('GET', `${base}/git/tags/${ref.sha}`)).object;
  if (ref?.type !== 'commit' || ref.sha !== commit) throw new Error('Remote tag no longer matches the tested commit');
  const prerelease = tag.replace(/^v/, '').split('+')[0].includes('-');
  const downloadBase = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/`;
  const body = `Image Format Lab — изучение и сравнение форматов изображений.\n\n` +
    `Скачайте [image-format-lab.html](${downloadBase}image-format-lab.html) и откройте файл в браузере. Кодеки встроены; для работы программы интернет не нужен.\n\n` +
    `Исходники встроенных компонентов с лицензиями и средствами пересборки:\n\n` +
    `- [gifenc-1.0.3-sources.zip](${downloadBase}gifenc-1.0.3-sources.zip)\n` +
    `- [heic-sources.zip](${downloadBase}heic-sources.zip) — HEIC/AVIF и связанные библиотеки.\n\n` +
    `Эти ZIP не нужны для обычной работы. Собственный код — MIT; библиотеки сохраняют свои лицензии, доступные в окне «Лицензии».\n\n` +
    `[Контрольные суммы SHA-256](${downloadBase}SHA256SUMS.txt). Проверенный коммит: ${commit}.\n`;
  const draft = await api('POST', `${base}/releases`, { tag_name: tag, target_commitish: commit, name: 'Image Format Lab ' + tag, body, draft: true, prerelease, make_latest: 'false' });
  if (!Number.isSafeInteger(draft.id) || draft.id <= 0) throw new Error('Invalid new release ID');
  let published = false;
  try {
    for (const [name, bytes] of files) {
      const asset = await api('POST', `https://uploads.github.com/repos/${repository}/releases/${draft.id}/assets?name=${encodeURIComponent(name)}`, bytes, true);
      if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.name !== name || asset.size !== bytes.length || asset.state !== 'uploaded') throw new Error('Incomplete upload: ' + name);
      await verifyDownload(`${base}/releases/assets/${asset.id}`, bytes, true);
    }
    await api('PATCH', `${base}/releases/${draft.id}`, { draft: false, prerelease, make_latest: prerelease ? 'false' : 'true' });
    published = true;
    const downloads = [...files].map(([name, bytes]) => [downloadBase + name, bytes]);
    if (!prerelease) downloads.push([`https://github.com/${repository}/releases/latest/download/image-format-lab.html`, files.get('image-format-lab.html')]);
    for (const [url, bytes] of downloads) {
      for (let attempt = 0; ; attempt++) {
        try { await verifyDownload(url, bytes); break; }
        catch (error) { if (attempt === 4) throw error; await sleep(3000); }
      }
    }
    return { tag, prerelease, url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}` };
  } catch (error) {
    throw new Error(`${tag}: ${published ? 'publication was confirmed' : 'a draft was created; publication may require inspection if the final request failed'}. No existing assets were deleted. ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  publishRelease(readAssets(path.join(root, 'dist/release')), { repository: process.env.GITHUB_REPOSITORY, tag: process.env.RELEASE_TAG, commit: process.env.RELEASE_COMMIT, token: process.env.GH_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
