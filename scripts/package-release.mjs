import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseCheckout } from './build-version.mjs';
import { checkRepository } from './check-repository.mjs';
import { assetNames, checksumName, checksumText, validateAssets, validateBrowserReport } from './release-assets.mjs';

try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { RELEASE_TAG: tag, GITHUB_REPOSITORY: repository } = process.env;
  verifyReleaseCheckout(tag, root);
  checkRepository(root, { allowBuiltHtml: true });
  const files = new Map(assetNames.map((name, i) => [name, fs.readFileSync(path.join(root, i ? 'vendor' : '', name))]));
  files.set(checksumName, Buffer.from(checksumText(files)));
  validateAssets(files, repository, tag);
  validateBrowserReport(JSON.parse(fs.readFileSync(path.join(root, 'test-results/release-modular-release.json'), 'utf8')), files.get(assetNames[0]));
  const destination = path.join(root, 'dist/release');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination); // Refuse an existing directory instead of mixing runs.
  for (const [name, bytes] of files) fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx' });
  console.log('Prepared four verified assets for ' + tag + ' in dist/release');
} catch (error) { console.error(error.message); process.exitCode = 1; }
