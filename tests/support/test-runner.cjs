const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
function runSuite(entry, {cwd, env = process.env, logs = null, runId = 'test', write = text => process.stdout.write(text)} = {}) {
  const label = entry.label || entry.name, timeoutMs = entry.timeoutMs;
  if (!/^[a-z0-9-]+$/.test(label) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid suite execution options');
  return new Promise(resolve => {
    const start = performance.now();
    let timedOut = false, spawnError = null, logError = null, timer;
    const logPath = logs ? path.join(logs, runId + '-modular-' + label + '.txt') : null;
    const stream = logPath ? fs.createWriteStream(logPath) : null;
    stream?.on('error', error => { logError = error.message; });
    const emit = value => { write(value); if (stream && !stream.destroyed) stream.write(value); };
    emit('START ' + label + ' (limit ' + (timeoutMs / 1000) + 's)\n');
    const child = spawn(process.execPath, [entry.file], {cwd, env, stdio:['ignore','pipe','pipe'], detached:process.platform !== 'win32'});
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', emit); child.stderr.on('data', emit);
    child.on('error', error => { spawnError = error.message; });
    timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio:'ignore', timeout:10000});
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) { if (error.code !== 'ESRCH') spawnError = 'Unable to terminate suite: ' + error.message; }
    }, timeoutMs);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const record = {name:entry.name, label, status:timedOut?'TIMEOUT':exitCode === 0 && !spawnError && !logError?'PASS':'FAIL', durationMs:Math.round(performance.now()-start), timeoutMs, exitCode, signal, error:spawnError || logError};
      emit(record.status + ' ' + label + ' (' + (record.durationMs / 1000).toFixed(2) + 's; exit=' + exitCode + (signal?'; signal='+signal:'') + (record.error?'; '+record.error:'') + ')\n');
      const finish = () => {
        if (logError) { record.status = timedOut ? 'TIMEOUT' : 'FAIL'; record.error = logError; write('FAIL log for ' + label + ': ' + logError + '\n'); }
        resolve(record);
      };
      if (stream && !stream.destroyed) stream.end(finish);
      else finish();
    });
  });
}
function summary(records, expected = records.length) {
  const passed = records.filter(r => r.status === 'PASS').length;
  return ['SUMMARY: ' + passed + '/' + expected + ' passed; ' + (records.length-passed) + ' failed; ' + (expected-records.length) + ' not run',
    'Slowest suites (seconds):', ...[...records].sort((a,b) => b.durationMs-a.durationMs).slice(0,10).map(r => r.status + ' ' + r.label + ': ' + (r.durationMs/1000).toFixed(2))].join('\n') + '\n';
}
module.exports = {runSuite, summary};
