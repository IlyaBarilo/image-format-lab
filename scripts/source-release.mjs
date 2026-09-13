import { releaseVersion } from './build-version.mjs';

export function githubSourceConfig(repository, tag) {
  releaseVersion({ release: true, tag });
  if (typeof repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) || ['.', '..'].includes(repository.split('/')[1])) throw new Error('Expected a GitHub repository as owner/name');
  const base = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/`;
  return { version: 1, urls: { gifenc: base + 'gifenc-1.0.3-sources.zip', heic: base + 'heic-sources.zip' } };
}

// Download locations are build metadata, never runtime codec dependencies.
export function sourcePackages(config, manifest, { release = false } = {}) {
  if (config?.version !== 1 || !config.urls || Object.keys(config.urls).sort().join(',') !== 'gifenc,heic') throw new Error('Invalid source-release.json');
  return Object.fromEntries(Object.entries({ gifenc: 'gifenc-1.0.3-sources.zip', heic: 'heic-sources.zip' }).map(([id, name]) => {
    const url = config.urls[id];
    if (url !== null) {
      let parsed;
      try { parsed = new URL(url); } catch { /* reported below */ }
      if (typeof url !== 'string' || !parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('Expected an absolute HTTPS source URL: ' + id);
    }
    if (release && !url) throw new Error('Public release requires source URLs in scripts/source-release.json: ' + id);
    const entry = manifest.files.find(item => item.file === name);
    if (!entry) throw new Error('Missing source package: ' + name);
    return [id, { name, bytes: entry.bytes, sha256: entry.sha256, url }];
  }));
}
