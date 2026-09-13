import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { githubSourceConfig } from './source-release.mjs';

export const assetNames = ['image-format-lab.html', 'gifenc-1.0.3-sources.zip', 'heic-sources.zip'];
export const checksumName = 'SHA256SUMS.txt';
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const checksumText = files => assetNames.map(name => `${sha256(files.get(name))}  ${name}\n`).join('');

export function validateAssets(files, repository, tag) {
  const config = githubSourceConfig(repository, tag);
  const expected = [...assetNames, checksumName];
  if (files.size !== expected.length || expected.some(name => !Buffer.isBuffer(files.get(name)) || !files.get(name).length)) throw new Error('Unexpected or incomplete release asset set');
  if (files.get(checksumName).toString('utf8') !== checksumText(files)) throw new Error('Release checksums do not match');
  const html = files.get(assetNames[0]).toString('utf8');
  const match = html.match(/id="embedded-codecs">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Missing release metadata');
  const payload = JSON.parse(match[1]);
  if (payload.releaseTag !== tag) throw new Error('HTML belongs to a different release tag');
  if (payload.sources || payload.sourceArchives) throw new Error('Source archives must remain separate');
  for (const [id, url] of Object.entries(config.urls)) {
    const info = payload.sourcePackages?.[id];
    const name = id === 'gifenc' ? assetNames[1] : assetNames[2];
    const bytes = files.get(name), hash = sha256(bytes);
    const entry = payload.manifest?.files?.find(item => item.file === name);
    if (info?.name !== name || info.url !== url || info.sha256 !== hash || info.bytes !== bytes.length || entry?.sha256 !== hash || entry.bytes !== bytes.length) throw new Error('Wrong source URL, bytes or manifest: ' + id);
  }
  return payload;
}

export function validateBrowserReport(report, html) {
  if (report?.passed !== true || report.publicHtml !== assetNames[0] || report.bytes !== html.length || report.sha256 !== sha256(html) || !Array.isArray(report.checks) || !report.checks.length || !Array.isArray(report.externalRequests) || report.externalRequests.length || !Array.isArray(report.errors) || report.errors.length) throw new Error('A successful offline browser report for these exact HTML bytes is required');
}

export function readAssets(directory) {
  const expected = [...assetNames, checksumName];
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Release directory must not be a symlink');
  const actual = fs.readdirSync(directory).sort(); // This explicit output directory only.
  if (actual.join('\0') !== [...expected].sort().join('\0')) throw new Error('Unexpected release directory contents');
  return new Map(expected.map(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release asset must be a regular file: ' + name);
    return [name, fs.readFileSync(file)];
  }));
}
