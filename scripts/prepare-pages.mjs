import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assetNames, checksumName, sha256, validateAssets } from './release-assets.mjs';
import { githubSourceConfig } from './source-release.mjs';

const [repository, destination] = process.argv.slice(2);
if (!repository || !destination) throw new Error('Usage: node scripts/prepare-pages.mjs owner/repo new-site-directory');

async function download(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

const headers = process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
const latest = await (await download(`https://api.github.com/repos/${repository}/releases/latest`, headers)).json();
const tag = latest.tag_name;
if (latest.draft !== false || latest.prerelease !== false || !tag?.startsWith('v')) {
  throw new Error('Expected a published stable release tagged with v');
}
const base = new URL('.', githubSourceConfig(repository, tag).urls.gifenc);
const files = new Map();
for (const name of [...assetNames, checksumName]) {
  const response = await download(new URL(name, base));
  files.set(name, Buffer.from(await response.arrayBuffer()));
}
validateAssets(files, repository, tag);

const html = files.get('image-format-lab.html');
await mkdir(destination);
await writeFile(path.join(destination, 'index.html'), html);
console.log(`Prepared ${tag}, ${html.length} bytes, SHA-256 ${sha256(html)}`);
