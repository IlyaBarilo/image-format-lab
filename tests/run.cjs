const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const artifacts = require('./support/artifacts.cjs');
const {suites, validateRegistry, selectSuites} = require('./suites.cjs');
const {runSuite, summary} = require('./support/test-runner.cjs');
const {prepareSharedViewer, sharedViewer} = require('./support/shared-viewer.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  validateRegistry();
  const {group, list, selected} = selectSuites(process.argv.slice(2));
  if (list) { console.log(JSON.stringify({group, total:selected.length, suites:selected.map(s => ({name:s.name, label:s.label, group:s.group, timeoutMs:s.timeoutMs}))}, null, 2)); return; }
  const logs = process.env.IMAGE_TEST_LOGS ? artifacts.folder(process.env.IMAGE_TEST_LOGS) : null;
  if (logs) fs.mkdirSync(logs, {recursive:true});
  const start = performance.now(), records = [];
  let prepared, setupError;
  try {
    let env = {...process.env};
    if (selected.some(s => s.group !== 'core' && s.name !== 'standalone-release')) {
      if (!sharedViewer(env)) {
        console.log('START shared instrumented HTML build');
        prepared = prepareSharedViewer();
        env = {...env, ...prepared.env};
        console.log('PASS shared instrumented HTML build (' + ((performance.now()-start)/1000).toFixed(2) + 's)');
      }
    }
    for (const entry of selected) {
      const record = await runSuite({...entry, file:path.join(__dirname, entry.name + '.cjs')}, {cwd:root, env:{...env, ...(entry.engine?{IMAGE_TEST_ENGINE:entry.engine}:{})}, logs, runId:artifacts.runId});
      records.push(record);
    }
  } catch (error) { setupError = error.message; throw error; } finally {
    prepared?.cleanup();
    const result = {group, registered:suites.length, selected:selected.length, completed:records.length, durationMs:Math.round(performance.now()-start), setupError:setupError || null, records};
    if (logs) fs.writeFileSync(path.join(logs, artifacts.runId + '-summary.json'), JSON.stringify(result,null,2)+'\n');
    const text = summary(records, selected.length);
    process.stdout.write(text);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Tests: ' + (group || 'selected/full') + '\n\n\x60\x60\x60text\n' + text + '\x60\x60\x60\n');
    if (records.length !== selected.length || records.some(r => r.status !== 'PASS')) process.exitCode = 1;
  }
}
main().catch(error => { console.error('FAIL test runner: ' + error.stack); process.exitCode = 1; });
