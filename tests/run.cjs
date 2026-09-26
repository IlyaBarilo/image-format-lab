const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const artifacts = require('./support/artifacts.cjs');
const root = path.resolve(__dirname, '..');
const tests = ['publication-policy', 'build-regressions', 'build-version', 'release-workflow', 'release-publishing', 'preferences', 'theme', 'source-packages', 'codec-compression', 'core-regressions', 'canvas-layout', 'analysis-layout', 'analysis-visibility', 'analysis-viewport', 'analysis-overlay', 'analysis-delta', 'file-import', 'jpeg-regressions', 'jpeg-encode', 'raster-codecs', 'raster-settings', 'tiff-regressions', 'viewer-files', 'viewer-batch', 'viewer-batch-dialog', 'viewer-batch-preview', 'viewer-enhancements', 'viewer-analysis', 'viewer-waveform', 'viewer-difference', 'viewer-vectorscope-profile', 'viewer-analysis-output', 'browser-regressions', 'heic-regressions', 'heic-encode-regressions', 'modern-regressions', 'standalone-release'];
tests.push('raster-worker', 'analysis-report', 'pixel-buffer', 'pixel-metrics', 'histogram-precision', 'error-histogram', 'viewer-error-histogram', 'reference-samples', 'experiment-protocol', 'viewer-experiment-protocol', 'quality-series', 'quality-series-controller', 'viewer-quality-series', 'png-precision', 'pixel-inspector', 'viewer-pixel-inspector', 'file-passport', 'viewer-file-passport', 'processing-timing');
tests.push('wipe-view', 'viewer-wipe-view');
tests.push('heif-blocks');
tests.push('jxl-blocks');
tests.push('analysis-guides');
tests.push('crop-source');
tests.push('signal-scopes');
tests.push('error-profile');
tests.push('ssim');
tests.push('png-indexed');
tests.push('modern-options');
tests.push('modern-native-options');
tests.push('jpeg-jxl-reconstruction');
tests.push('avif-speed');
tests.push('avif-native-speed');
tests.push('tiff16');
tests.push('display-sdr');
const requested = process.argv.slice(2);
if (requested.some(name => !tests.includes(name))) throw new Error('Unknown test suite');
let failures = 0;
for (const name of requested.length ? requested : tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name + '.cjs')], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error ? '\n' + result.error.stack : '');
  if (process.env.IMAGE_TEST_LOGS) {
    const folder = artifacts.folder(process.env.IMAGE_TEST_LOGS);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, artifacts.runId + '-modular-' + name + '.txt'), output);
  }
  if (result.status !== 0) { failures++; process.stderr.write(output); }
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`);
}
process.exitCode = failures ? 1 : 0;
