import { OPTIONAL_CODECS } from '../core/config.mjs';
import { diagnosticConfig, diagnosticEnvironment, diagnosticError, diagnosticHash, diagnosticPixelHash,
  diagnosticByteLength, formatDiagnostics, DIAGNOSTIC_LIMIT, recordDiagnosticEvent, diagnosticLibraries } from '../core/diagnostics.mjs';
import { runDiagnosticTests, DIAGNOSTIC_CASES } from '../services/diagnostic-tests.mjs';
import reference from '../diagnostic-reference.json';

export function createDiagnostics({ app, els }, deps) {
  let controller, revision = 0, attached = false;
  const get = id => document.getElementById(id);
  async function snapshot() {
    const source = app.source, sourceFile = source?.file ?? app.files?.find(item=>item.id===app.selectedFileId)?.file, sourcePixels = source?.pixelBuffer;
    const cells = app.variants.map(v => ({ index: v.index + 1, status: deps.isVariantReady(v) ? 'ready' : v.error ? diagnosticError(v.error) : v.processing ? 'pending' : 'stale',
      config: diagnosticConfig(deps.isVariantReady(v) ? v.resultConfig : v.config),
      numbers: deps.isVariantReady(v) ? [v.measurement?.bytes, v.measurement?.width, v.measurement?.height, v.measurement?.psnrRGB, v.measurement?.alphaErrorPercent, v.measurement?.processingMs] : [],
      paths: (v.encodingPath ?? '-') + '/' + (v.decodingPath ?? '-'), blob: deps.isVariantReady(v) ? v.blob : null, pixels: deps.isVariantReady(v) ? v.pixelBuffer : null }));
    const events = (app.diagnosticEvents ?? []).map(event => [...event]);
    let payload = {};
    try { payload = JSON.parse(get('embedded-codecs')?.textContent ?? '{}'); } catch { events.push(['payload', 'invalid']); }
    const libraries = diagnosticLibraries(payload.components?.components ?? []);
    if(!libraries.length||!payload.buildId)events.push(['error','metadata-missing']);
    const batch=app.batchRun?.config??app.exportConfig;
    const batchText=batch?[diagnosticConfig(batch),batch.resizeWidth||'-',batch.resizeHeight||'-',batch.targetKB||'-',batch.minQuality??'-',batch.metadataPolicy??'-',batch.delivery??'-',app.files?.length??0].join('/'):'-';
    const kind=sourceFile?(deps.fileKind?.(sourceFile)||({'image/svg+xml':'svg','image/png':'png','image/jpeg':'jpeg','image/webp':'webp','image/avif':'avif','image/tiff':'tiff','image/heic':'heic'}[sourceFile.type]??'unknown')):'-';
    const codecStates = Object.keys(OPTIONAL_CODECS).map(key => `${key}=${app.codecs[key] ? 'r' : app.codecPromises[key] ? 'p' : app.codecAttempts[key] ? 'e' : 'i'}`);
    const analysis = deps.getAnalysisSnapshot?.().settings ?? {};
    const region = analysis.region, line = analysis.line;
    const coord = value => Number.isFinite(value) ? Number(value.toFixed(5)) : '-';
    const bounds = value => value?.unit === 'pixels' || value?.width != null ? [value.x,value.y,value.width,value.height].map(coord).join(',') : value ? [value.x0,value.y0,value.x1,value.y1].map(coord).join(',') : '-';
    const viewports = (analysis.viewports ?? []).map(item => bounds(item.region)).join(';');
    const origin = /-area-x(\d+)-y(\d+)-(\d+)x(\d+)\.png$/i.exec(source?.name ?? '');
    const state = app.sourceLoading ? 'loading' : app.sourceError ? diagnosticError(app.sourceError) : source ? 'source' : 'empty';
    const view = [app.layout, +!!app.wipe?.active, els.metadataPolicy?.value ?? '-', analysis.type ?? '-', analysis.display ?? '-', analysis.scope ?? '-',
      analysis.channel ?? analysis.errorChannel ?? analysis.profileChannel ?? analysis.differenceChannel ?? '-', analysis.matte ?? '-', analysis.level ?? '-',
      bounds(region), line ? [line.x0,line.y0,line.x1,line.y1].map(coord).join(',') : '-', viewports,
      app.display?.mode ?? '-', coord(app.view?.zoom), coord(app.view?.centerX), coord(app.view?.centerY),
      app.batchRun?.running ? 'batch-running' : 'batch-idle',
      [analysis.gain,analysis.position,analysis.inkLimit,app.display?.black,app.display?.white,app.display?.exposure].map(coord).join(',')].join('/');
    const report = { build: payload.buildId ?? '-', release: payload.releaseTag ?? '', environment: diagnosticEnvironment(),
      libraries, codecs: codecStates, state, events, view, batch:batchText, source: source ? [kind,source.width, source.height, source.size, sourcePixels?.sampleType, sourcePixels?.bitDepth, sourcePixels?.colorSpace,
        sourcePixels?.alphaMode, +!!source.iccProfile, +!!source.cmyk, source.decodingPath ?? '-', origin ? origin.slice(1).join(',') : '-'] : [kind,sourceFile?.size??'-'], cells, tests: [], verdict: 'pending' };
    payload = null;
    const safeHash = async task => {try{return await task();}catch(error){const code=diagnosticError(error);report.events.push(['error',code]);report.events=report.events.slice(-6);return 'error';}};
    if (sourceFile||source) report.source.push(sourceFile ? await safeHash(()=>diagnosticHash(sourceFile)) : '-', await safeHash(()=>diagnosticPixelHash(sourcePixels)));
    for (const cell of cells) {
      cell.hashes = [cell.blob ? await safeHash(()=>diagnosticHash(cell.blob)) : '-', await safeHash(()=>diagnosticPixelHash(cell.pixels))];
      delete cell.blob; delete cell.pixels;
    }
    return report;
  }
  async function diagnosticReport({ signal, progress } = {}) {
    const report = await snapshot();
    let photo = null;
    try {
      const encoded = JSON.parse(get('embedded-samples')?.textContent ?? '{}').photo;
      if (encoded) photo = new Blob([Uint8Array.from(atob(encoded), value => value.charCodeAt(0))], { type: 'image/webp' });
    } catch { /* A missing fixture is an explicit test result. */ }
    try {report.tests = await (deps.runDiagnosticTests ?? runDiagnosticTests)({ createRuntime: deps.createDiagnosticRuntime, photo, signal, progress });}
    catch(error){report.tests=DIAGNOSTIC_CASES.map(id=>({id,error:diagnosticError(error)}));}
    report.actual=Object.entries(report.tests.codecInfo??{}).map(([key,value])=>key+'='+Object.values(value).filter(Boolean).join('/'));
    const info=report.tests.codecInfo??{};
    const versions=[['heif',info.heic?.version],['de265',info.heic?.decoder],['jpeg',info.utif?.jpegVersion]];
    const versionErrors=versions.filter(([key,value])=>value&&!report.libraries.includes(key+'='+value)).length;
    for (const test of report.tests) {
      const expected = reference.tests[test.id];
      if (!expected && !reference.informational?.includes(test.id) && !test.error) test.error = 'reference-missing';
      test.mismatch = !test.error && !!expected && Object.entries(expected).some(([key, value]) => test[key] !== value);
    }
    const incomplete = report.tests.length!==DIAGNOSTIC_CASES.length||report.tests.some(test => /cancel|reference-missing/.test(test.error ?? ''));
    const problems = report.tests.filter(test => test.error && !/cancel/.test(test.error) || test.mismatch).length;
    const currentErrors = report.state.includes(':') || report.cells.some(cell => cell.status.includes(':')) || report.codecs.some(value => value.endsWith('=e')) || report.events.some(event => ['error','page','promise'].includes(event[0]));
    report.verdict = incomplete ? 'INCOMPLETE' : problems || currentErrors || versionErrors ? `DIFFERENCES tests=${problems} current=${+currentErrors}${versionErrors?' versions='+versionErrors:''}` : 'OK checked paths';
    const text = formatDiagnostics(report), bytes = diagnosticByteLength(text);
    return { report, text, bytes, fits: bytes <= DIAGNOSTIC_LIMIT };
  }
  function stop() { controller?.abort(); }
  async function openDiagnostics() {
    const dialog = get('diagnosticDialog');
    if (dialog.open) return;
    const current = ++revision;
    controller = new AbortController();
    get('diagnosticText').value = ''; get('diagnosticCopy').disabled = get('diagnosticDownload').disabled = true;
    get('diagnosticVerdict').textContent = 'Проверка…';
    get('diagnosticVerdict').dataset.state='pending';get('diagnosticStop').disabled=false;
    get('diagnosticProgress').textContent = 'Сохраняется состояние программы…';
    dialog.showModal();
    try {
      const result = await diagnosticReport({ signal: controller.signal, progress: (id, done, total) => {
        if (current === revision) get('diagnosticProgress').textContent = `Проверки: ${done + 1}/${total} · ${id}`;
      } });
      if (current !== revision || !dialog.open) return;
      get('diagnosticText').value = result.text;
      get('diagnosticProgress').textContent = `${result.bytes} байт UTF-8 · предел ${DIAGNOSTIC_LIMIT} байт`;
      get('diagnosticVerdict').textContent = result.report.verdict.startsWith('OK') ? 'Проверенные пути совпали с контрольными результатами.'
        : result.report.verdict === 'INCOMPLETE' ? 'Проверка неполная.' : 'Есть расхождения или ошибки.';
      get('diagnosticVerdict').dataset.state=result.report.verdict.startsWith('OK')?'ok':result.report.verdict==='INCOMPLETE'?'incomplete':'different';
      get('diagnosticStop').disabled=true;
      if (!result.fits) get('diagnosticProgress').textContent += ' · превышение размера; полный текст сохранён без обрезания';
      get('diagnosticCopy').disabled = !result.fits; get('diagnosticDownload').disabled = false;
    } catch (error) {
      if (current !== revision || !dialog.open) return;
      get('diagnosticVerdict').textContent = 'Проверка неполная.';
      get('diagnosticVerdict').dataset.state='incomplete';get('diagnosticStop').disabled=true;
      get('diagnosticProgress').textContent = diagnosticError(error);
    } finally { if (current === revision) controller = null; }
  }
  function attachDiagnosticEvents() {
    if (attached) return; attached = true;
    get('reportDiagnostic').addEventListener('click', openDiagnostics);
    get('diagnosticStop').addEventListener('click', stop);
    const dialog = get('diagnosticDialog');
    dialog.addEventListener('close', () => { revision++; stop(); get('reportDiagnostic').focus(); });
    get('diagnosticCopy').addEventListener('click', async () => {
      const text = get('diagnosticText').value;
      try { await navigator.clipboard.writeText(text); get('diagnosticProgress').textContent = 'Отчёт скопирован.'; }
      catch {
        get('diagnosticText').focus(); get('diagnosticText').select();
        let copied = false; try { copied = !!document.execCommand?.('copy'); } catch {}
        get('diagnosticProgress').textContent = copied ? 'Отчёт скопирован.' : 'Текст отчёта выделен.';
      }
    });
    get('diagnosticDownload').addEventListener('click', () => deps.downloadBlob(new Blob([get('diagnosticText').value], { type: 'text/plain;charset=utf-8' }), 'image-format-lab-diagnostics.txt'));
    globalThis.addEventListener?.('error', event => recordDiagnosticEvent(app.diagnosticEvents ??= [], 'page', event.error ?? event.message));
    globalThis.addEventListener?.('unhandledrejection', event => recordDiagnosticEvent(app.diagnosticEvents ??= [], 'promise', event.reason));
  }
  return { diagnosticReport, openDiagnostics, attachDiagnosticEvents };
}
