const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {suites, groups, validateRegistry, selectSuites} = require('./suites.cjs');
const {runSuite, summary} = require('./support/test-runner.cjs');
const {prepareSharedViewer, sharedViewer} = require('./support/shared-viewer.cjs');
(async () => {
  validateRegistry();
  assert.equal(new Set(suites.map(s => s.name)).size, suites.length);
  assert.deepEqual(groups.flatMap(group => selectSuites(['--group',group]).selected.map(s => s.name)).sort(), suites.map(s => s.name).sort());
  assert.throws(() => validateRegistry(suites.slice(1)), /Missing/);
  assert.throws(() => validateRegistry([...suites,suites[0]]), /Duplicate/);
  assert.throws(() => selectSuites(['--group','unknown']), /Unknown/);
  assert.throws(() => selectSuites(['--group','core','theme']), /either/);
  assert.throws(() => selectSuites(['theme','theme']), /duplicate/);
  assert.throws(() => selectSuites(['--firefox','theme']), /Firefox requires/);
  const firefox = selectSuites(['--group','codecs','--firefox']).selected;
  assert.equal(firefox.filter(s => s.engine === 'firefox').length, 1);
  assert.equal(firefox.at(-1).label, 'viewer-diagnostics-firefox');
  assert.equal(selectSuites(['theme']).selected[0].name, 'theme');
  for (const suite of suites) {
    const browser = /require\(['"]playwright['"]\)/.test(fs.readFileSync(path.join(__dirname,suite.name+'.cjs'),'utf8'));
    assert.equal(suite.group !== 'core', browser, 'browser dependency must match CI installation: ' + suite.name);
  }
  const listed = JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'run.cjs'),'--list'],{encoding:'utf8'}));
  assert.equal(listed.total, suites.length);
  const failedSetup=spawnSync(process.execPath,[path.join(__dirname,'run.cjs'),'--group','viewer'],{encoding:'utf8',env:{...process.env,IMAGE_TEST_VIEWER_HTML:'relative.html',IMAGE_TEST_VIEWER_SHA256:'a'.repeat(64),IMAGE_TEST_LOGS:'',GITHUB_STEP_SUMMARY:''}});
  assert.equal(failedSetup.status,1);assert(failedSetup.stdout.includes('6 not run'));assert(failedSetup.stderr.includes('Invalid shared'));

  const base = fs.realpathSync(os.tmpdir()), folder = fs.mkdtempSync(path.join(base,'test-runner-fixture-'));
  const files = [];
  function fixture(name, source) { const file=path.join(folder,name+'.cjs');fs.writeFileSync(file,source);files.push(file);return file; }
  let output='';
  const options = {cwd:folder, logs:folder, runId:'unit', write:text=>{output+=text;}};
  try {
    const pass=fixture('pass',"console.log('child output');console.error('child detail');");
    const fail=fixture('fail',"console.log('PASS from inside a failing child');process.exitCode=7;");
    const entry=(name,file,timeoutMs=10000)=>({name,label:name,file,timeoutMs});
    const a=await runSuite(entry('pass',pass),options);
    const b=await runSuite(entry('fail',fail),options);
    const missing=await runSuite(entry('missing',path.join(folder,'missing.cjs')),options);
    const badCwd=await runSuite(entry('bad-cwd',pass),{...options,cwd:path.join(folder,'absent')});
    const beat=path.join(folder,'beat.txt');files.push(beat);
    const grandchild=fixture('grandchild',"require('fs').appendFileSync("+JSON.stringify(beat)+",'start');setInterval(()=>require('fs').appendFileSync("+JSON.stringify(beat)+",'.'),25);");
    const hang=fixture('hang',"require('child_process').spawn(process.execPath,["+JSON.stringify(grandchild)+"],{stdio:'inherit'});setInterval(()=>{},1000);");
    const timeout=await runSuite(entry('hang',hang,1000),options);
    const signalFile=fixture('signal',"process.kill(process.pid,'SIGTERM');");
    const signalled=await runSuite(entry('signal',signalFile),options);assert.equal(signalled.status,'FAIL');
    if(process.platform!=='win32')assert.equal(signalled.signal,'SIGTERM');
    const large=fixture('large',"process.stdout.write('x'.repeat(5*1024*1024));");let streamed=0;
    const largeResult=await runSuite(entry('large',large),{...options,write:chunk=>{streamed+=chunk.length;}});
    assert.equal(largeResult.status,'PASS');assert(streamed>5*1024*1024);
    assert(fs.statSync(path.join(folder,'unit-modular-large.txt')).size>5*1024*1024);
    const continued=await runSuite(entry('continued',pass),options);
    assert.equal(a.status,'PASS');assert.equal(b.status,'FAIL');assert.equal(b.exitCode,7);
    assert.equal(missing.status,'FAIL');assert.equal(badCwd.status,'FAIL');assert(badCwd.error);
    assert.equal(timeout.status,'TIMEOUT');assert(timeout.durationMs>=1000);
    assert.equal(continued.status,'PASS','a failed/timed-out child must not skip the next suite');
    const before=fs.existsSync(beat)?fs.readFileSync(beat,'utf8'):null;
    assert(before?.startsWith('start'),'grandchild ran before the process-tree timeout');
    await new Promise(r=>setTimeout(r,100));
    assert.equal(fs.readFileSync(beat,'utf8'),before,'timeout must terminate grandchildren too');
    assert(output.includes('START pass')&&output.includes('child output')&&output.includes('child detail')&&output.includes('exit=7'));
    assert(summary([a,b,timeout]).includes('1/3 passed; 2 failed'));
    const log=fs.readFileSync(path.join(folder,'unit-modular-fail.txt'),'utf8');
    assert(log.includes('PASS from inside')&&log.includes('FAIL fail')&&log.includes('exit=7'));
    assert.throws(()=>sharedViewer({IMAGE_TEST_VIEWER_HTML:'relative.html',IMAGE_TEST_VIEWER_SHA256:'a'.repeat(64)}),/Invalid/);
    const html=fixture('not-html','nothing');assert.throws(()=>sharedViewer({IMAGE_TEST_VIEWER_HTML:html,IMAGE_TEST_VIEWER_SHA256:'a'.repeat(64)}),/Invalid/);
  } finally {
    for(const name of ['pass','fail','missing','bad-cwd','hang','continued','signal','large']) files.push(path.join(folder,'unit-modular-'+name+'.txt'));
    for(const file of files) {
      assert.equal(path.dirname(path.resolve(file)),folder);
      if(fs.existsSync(file))fs.unlinkSync(file);
    }
    assert.equal(path.dirname(fs.realpathSync(folder)),base);fs.rmdirSync(folder);
  }
  const original=fs.readFileSync(path.join(__dirname,'../image-format-lab.html'));
  const prepared=prepareSharedViewer();
  try {
    const script="const fs=require('fs');const p=require("+JSON.stringify(path.join(__dirname,'support/viewer-path.cjs'))+");const a=p(),b=p();if(a!==process.env.IMAGE_TEST_VIEWER_HTML||a!==b)throw Error('not reused');if(!fs.existsSync(a))throw Error('missing');";
    for(let n=0;n<2;n++)execFileSync(process.execPath,['-e',script],{env:{...process.env,...prepared.env},stdio:'pipe'});
    assert.equal(sharedViewer(prepared.env),prepared.env.IMAGE_TEST_VIEWER_HTML,'children must not delete parent-owned HTML');
    assert.throws(()=>sharedViewer({...prepared.env,IMAGE_TEST_VIEWER_SHA256:'0'.repeat(64)}),/integrity/);
    assert.deepEqual(fs.readFileSync(path.join(__dirname,'../image-format-lab.html')),original,'shared build must retain the normal HTML');
  } finally {prepared.cleanup();}
  assert.equal(fs.existsSync(prepared.env.IMAGE_TEST_VIEWER_HTML),false);
  console.log('PASS registry coverage, CLI, streamed logs, failure/signal/timeout handling, process trees and shared HTML ownership/integrity');
})().catch(error=>{console.error(error);process.exitCode=1;});
