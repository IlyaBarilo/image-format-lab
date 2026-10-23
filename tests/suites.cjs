// Complete suite registry and independent CI groups. Own test infrastructure, MIT.
const fs = require('node:fs');
const path = require('node:path');
const names = [
  "publication-policy",
  "knowledge",
  "knowledge-ui",
  "build-regressions",
  "build-version",
  "release-workflow",
  "release-publishing",
  "preferences",
  "theme",
  "source-packages",
  "codec-compression",
  "core-regressions",
  "canvas-layout",
  "analysis-layout",
  "analysis-visibility",
  "analysis-viewport",
  "analysis-overlay",
  "analysis-delta",
  "file-import",
  "jpeg-regressions",
  "jpeg-encode",
  "raster-codecs",
  "raster-settings",
  "tiff-regressions",
  "viewer-files",
  "viewer-batch",
  "viewer-batch-dialog",
  "viewer-batch-preview",
  "viewer-enhancements",
  "viewer-analysis",
  "viewer-waveform",
  "viewer-difference",
  "viewer-vectorscope-profile",
  "viewer-analysis-output",
  "browser-regressions",
  "heic-regressions",
  "heic-encode-regressions",
  "modern-regressions",
  "standalone-release",
  "raster-worker",
  "analysis-report",
  "pixel-buffer",
  "pixel-metrics",
  "histogram-precision",
  "float-source-histogram",
  "error-histogram",
  "viewer-error-histogram",
  "reference-samples",
  "experiment-protocol",
  "viewer-experiment-protocol",
  "quality-series",
  "quality-series-controller",
  "viewer-quality-series",
  "png-precision",
  "pixel-inspector",
  "viewer-pixel-inspector",
  "file-passport",
  "viewer-file-passport",
  "processing-timing",
  "wipe-view",
  "viewer-wipe-view",
  "heif-blocks",
  "print-check",
  "jxl-blocks",
  "analysis-guides",
  "crop-source",
  "comparison-summary",
  "signal-scopes",
  "precise-vector-difference",
  "boundary-map",
  "waveform-worker",
  "error-profile",
  "ssim",
  "png-indexed",
  "icc-extended",
  "color-sdr",
  "tiff-icc-worker",
  "modern-options",
  "modern-native-options",
  "jpeg-jxl-reconstruction",
  "avif-speed",
  "avif-native-speed",
  "tiff16",
  "tiff-float",
  "jxl16",
  "jxl-icc",
  "display-sdr",
  "jpeg2000",
  "cmyk",
  "icc-sdr",
  "comparison-readiness",
  "diagnostics",
  "diagnostics-ui",
  "application-diagnostics",
  "diagnostics-firefox",
  "viewer-diagnostics",
  "range-number",
  "viewer-range-number",
  "application-source",
  "analysis-readout"
];
names.push('test-runner');
const browserGroups = {
  viewer: ['viewer-files','viewer-batch','viewer-batch-dialog','viewer-batch-preview','viewer-enhancements','browser-regressions'],
  analysis: ['viewer-analysis','viewer-waveform','viewer-difference','viewer-vectorscope-profile','viewer-analysis-output','viewer-error-histogram','viewer-experiment-protocol','viewer-quality-series','viewer-pixel-inspector','viewer-file-passport','viewer-wipe-view','viewer-range-number'],
  codecs: ['tiff-regressions','heic-regressions','heic-encode-regressions','modern-regressions','standalone-release','viewer-diagnostics']
};
const groups = ['core', ...Object.keys(browserGroups)];
const membership = new Map();
for (const [group, entries] of Object.entries(browserGroups)) for (const name of entries) {
  if (membership.has(name) || !names.includes(name)) throw new Error('Invalid browser group entry: ' + name);
  membership.set(name, group);
}
const suites = names.map(name => Object.freeze({name, group:membership.get(name) || 'core', timeoutMs:membership.has(name) ? 600000 : 300000}));
function validateRegistry(entries = suites) {
  const seen = new Set();
  for (const entry of entries) {
    if (!/^[a-z0-9-]+$/.test(entry.name) || seen.has(entry.name)) throw new Error('Duplicate/invalid suite: ' + entry.name);
    if (!groups.includes(entry.group) || !Number.isSafeInteger(entry.timeoutMs) || entry.timeoutMs <= 0) throw new Error('Invalid group/timeout: ' + entry.name);
    if (!fs.statSync(path.join(__dirname, entry.name + '.cjs')).isFile()) throw new Error('Missing suite: ' + entry.name);
    seen.add(entry.name);
  }
  if (seen.size !== names.length || names.some(name => !seen.has(name))) throw new Error('Missing registered suite');
  return entries;
}
function selectSuites(args) {
  let group = null, list = false, firefox = false;
  const requested = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--group') {
      if (group !== null || !groups.includes(args[i + 1])) throw new Error('Unknown/duplicate test group');
      group = args[++i];
    } else if (arg === '--list' && !list) list = true;
    else if (arg === '--firefox' && !firefox) firefox = true;
    else if (names.includes(arg) && !requested.includes(arg)) requested.push(arg);
    else throw new Error('Unknown/duplicate test suite or option: ' + arg);
  }
  if (group && requested.length) throw new Error('Choose either a group or individual suites');
  let selected = group ? suites.filter(entry => entry.group === group) : requested.length ? requested.map(name => suites.find(entry => entry.name === name)) : suites;
  selected = selected.map(entry => ({...entry, label:entry.name}));
  if (firefox) {
    if (!selected.some(entry => entry.name === 'viewer-diagnostics')) throw new Error('Firefox requires viewer-diagnostics');
    selected.push({...suites.find(entry => entry.name === 'viewer-diagnostics'), label:'viewer-diagnostics-firefox', engine:'firefox'});
  }
  return {group, list, selected};
}
module.exports = {suites:Object.freeze(suites), groups:Object.freeze(groups), validateRegistry, selectSuites};
