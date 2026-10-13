import { OPTIONAL_CODECS } from '../core/config.mjs';
import { diagnosticConfig, diagnosticEnvironment, diagnosticError, diagnosticHash, diagnosticPixelHash,
  diagnosticByteLength, formatDiagnostics, DIAGNOSTIC_LIMIT, DIAGNOSTIC_FORM, recordDiagnosticEvent, diagnosticLibraries, evaluateDiagnosticTest, diagnosticValue } from '../core/diagnostics.mjs';
import { DIAGNOSTIC_LABELS, diagnosticFieldLabel, diagnosticErrorDescription } from '../core/diagnostic-labels.mjs';
import { runDiagnosticTests, DIAGNOSTIC_CASES } from '../services/diagnostic-tests.mjs';
import reference from '../diagnostic-reference.json';

export function createDiagnostics({ app, els }, deps) {
  let controller, revision = 0, attached = false, returnFocus;
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
    report.issues = [];
    const versionErrors=versions.filter(([key,value])=>value&&!report.libraries.includes(key+'='+value));
    for (const [key, value] of versionErrors) report.issues.push({ id: 'version-' + key, detail: `${report.libraries.find(item => item.startsWith(key + '='))?.slice(key.length + 1) ?? '-'}>${value}`,
      description: `Версия ${key}: ожидалось ${report.libraries.find(item => item.startsWith(key + '='))?.slice(key.length + 1) ?? 'значение реестра'}, получено ${value}.` });
    for (const test of report.tests) {
      evaluateDiagnosticTest(test, reference.tests[test.id], reference.informational?.includes(test.id));
    }
    const incomplete = report.tests.length!==DIAGNOSTIC_CASES.length||report.tests.some(test => /cancel|reference-missing/.test(test.error ?? ''));
    const problems = report.tests.filter(test => test.error && !/cancel/.test(test.error) || test.mismatch).length;
    if (report.state.includes(':')) report.issues.push({ id: 'source', detail: report.state, description: 'В момент запуска исходник был в состоянии ошибки. ' + diagnosticErrorDescription(report.state) });
    for (const cell of report.cells) if (cell.status.includes(':')) report.issues.push({ id: 'cell' + cell.index, detail: cell.status, description: `В момент запуска ячейка ${cell.index} была в состоянии ошибки. ` + diagnosticErrorDescription(cell.status) });
    for (const state of report.codecs) if (state.endsWith('=e')) report.issues.push({ id: 'codec', detail: state, description: `В момент запуска загрузчик ${state.slice(0, -2)} сообщил ошибку.` });
    for (const event of report.events) if (['error','page','promise'].includes(event[0])) report.issues.push({ id: 'session', detail: event.join(':'), description: 'В текущем сеансе ранее зарегистрирована ошибка. ' + diagnosticErrorDescription(event[1]) });
    const currentErrors = report.issues.length - versionErrors.length;
    report.verdict = incomplete ? 'INCOMPLETE' : problems || report.issues.length ? `DIFFERENCES tests=${problems} current=${currentErrors}${versionErrors.length?' versions='+versionErrors.length:''}` : 'OK checked paths';
    const text = formatDiagnostics(report), bytes = diagnosticByteLength(text);
    return { report, text, bytes, fits: bytes <= DIAGNOSTIC_LIMIT };
  }
  function stop() { controller?.abort(); }
  function showSummary(report) {
    const tests = report.tests ?? [], total = DIAGNOSTIC_CASES.length;
    const failed = tests.filter(test => test.status === 'FAIL').length;
    const informational = tests.filter(test => test.status === 'INFO').length;
    const skipped = tests.filter(test => test.status === 'SKIP').length;
    const passed = tests.filter(test => test.status === 'PASS').length;
    const issues = report.issues?.length ?? 0;
    const incomplete = report.verdict === 'INCOMPLETE' || skipped > 0 || tests.length !== total;
    const state = failed || issues ? 'different' : incomplete ? 'incomplete' : 'ok';
    get('diagnosticSummary').dataset.state = state;
    get('diagnosticVerdict').dataset.state = state;
    get('diagnosticVerdict').textContent = state === 'ok' ? 'Все тесты пройдены'
      : state === 'different' ? incomplete ? 'Есть ошибки или расхождения · проверка неполная' : 'Есть ошибки или расхождения'
        : 'Проверка не завершена';
    get('diagnosticCounts').textContent = `Завершено ${passed + informational + failed} из ${total} · ошибок/расхождений в тестах: ${failed} · замечаний состояния: ${issues}${skipped ? ' · пропущено: ' + skipped : ''}${informational ? ' · информационных: ' + informational : ''}`;
  }
  function renderResults(result) {
    const output = get('diagnosticOutput'), details = get('diagnosticDetails');
    output.replaceChildren(); details.replaceChildren();
    for (const line of result.text.trimEnd().split('\n')) {
      const row = document.createElement('span'); row.textContent = line + '\n';
      row.className = 'diagnostic-line'; row.dataset.status = /^(PASS|FAIL|INFO|SKIP)\b/.exec(line)?.[1] ?? '';
      output.appendChild(row);
    }
    for (const test of result.report.tests.filter(test => test.status === 'FAIL' || test.status === 'SKIP')) {
      const row = document.createElement('li');
      const reason = test.error ? diagnosticErrorDescription(test.error) : test.differences.map(d => `${diagnosticFieldLabel(test, d.key)}: ожидалось ${diagnosticValue(d.expected)}, получено ${diagnosticValue(d.actual)}`).join('; ') + '.';
      row.textContent = `${test.status} · ${DIAGNOSTIC_LABELS[test.id] ?? test.id}: ${reason}`;
      row.dataset.status = test.status; details.appendChild(row);
    }
    for (const issue of result.report.issues) {
      const row = document.createElement('li'); row.dataset.status = 'FAIL'; row.textContent = 'FAIL · ' + issue.description; details.appendChild(row);
    }
    if (!details.children.length) { const row = document.createElement('li'); row.textContent = 'Контрольные проверки завершены без расхождений. INFO — сведения об особенностях браузера, а не ошибка.'; details.appendChild(row); }
  }
  async function openDiagnostics(event) {
    const dialog = get('diagnosticDialog');
    if (dialog.open) return;
    const current = ++revision;
    returnFocus = event?.currentTarget ?? document.activeElement;
    controller = new AbortController();
    get('diagnosticText').value = ''; get('diagnosticText').hidden = true;
    get('diagnosticOutput').replaceChildren(); get('diagnosticDetails').replaceChildren();
    get('diagnosticCopy').disabled = get('diagnosticDownload').disabled = get('diagnosticSend').disabled = true;
    get('diagnosticBar').max = DIAGNOSTIC_CASES.length; get('diagnosticBar').value = 0;
    get('diagnosticVerdict').textContent = 'Проверка выполняется…';
    get('diagnosticCounts').textContent = 'Итог появится автоматически после завершения проверок.';
    get('diagnosticSummary').dataset.state = 'pending';
    get('diagnosticVerdict').dataset.state='pending';get('diagnosticStop').disabled=false;
    get('diagnosticProgress').textContent = 'Сохраняется состояние программы…';
    dialog.showModal();
    try {
      const result = await diagnosticReport({ signal: controller.signal, progress: (id, done, total) => {
        if (current === revision) {
          get('diagnosticBar').max = total; get('diagnosticBar').value = done;
          get('diagnosticProgress').textContent = `Завершено ${done}/${total}${id ? ' · ' + (DIAGNOSTIC_LABELS[id] ?? id) : ''}`;
        }
      } });
      if (current !== revision || !dialog.open) return;
      get('diagnosticText').value = result.text;
      renderResults(result);
      const completed = result.report.tests.filter(test => !test.error?.startsWith('cancel')).length;
      get('diagnosticBar').value = completed;
      get('diagnosticProgress').textContent = `Завершено ${completed}/${DIAGNOSTIC_CASES.length} · ${result.bytes} байт UTF-8 · предел ${DIAGNOSTIC_LIMIT} байт`;
      showSummary(result.report);
      get('diagnosticStop').disabled=true;
      if (!result.fits) get('diagnosticProgress').textContent += ' · превышение размера; полный текст сохранён без обрезания';
      get('diagnosticCopy').disabled = get('diagnosticSend').disabled = !result.fits; get('diagnosticDownload').disabled = false;
    } catch (error) {
      if (current !== revision || !dialog.open) return;
      get('diagnosticVerdict').textContent = 'Проверка не завершена';
      get('diagnosticCounts').textContent = diagnosticErrorDescription(diagnosticError(error));
      get('diagnosticSummary').dataset.state='incomplete';get('diagnosticVerdict').dataset.state='incomplete';get('diagnosticStop').disabled=true;
      get('diagnosticProgress').textContent = diagnosticError(error);
    } finally { if (current === revision) controller = null; }
  }
  function attachDiagnosticEvents() {
    if (attached) return; attached = true;
    get('reportDiagnostic').addEventListener('click', openDiagnostics);
    get('diagnosticOpen').addEventListener('click', openDiagnostics);
    get('diagnosticStop').addEventListener('click', stop);
    const dialog = get('diagnosticDialog');
    dialog.addEventListener('close', () => { revision++; stop(); returnFocus?.focus?.(); });
    async function copyReport() {
      const text = get('diagnosticText').value;
      try { await navigator.clipboard.writeText(text); get('diagnosticProgress').textContent = 'Отчёт скопирован.'; return true; }
      catch {
        get('diagnosticText').hidden = false;
        get('diagnosticText').focus(); get('diagnosticText').select();
        let copied = false; try { copied = !!document.execCommand?.('copy'); } catch {}
        get('diagnosticProgress').textContent = copied ? 'Отчёт скопирован.' : 'Текст выделен. Нажмите Ctrl+C или ⌘C, затем вставьте его в форму.';
        if (copied) get('diagnosticText').hidden = true;
        return copied;
      }
    }
    get('diagnosticCopy').addEventListener('click', copyReport);
    get('diagnosticSend').addEventListener('click', async () => {
      // Open on the click itself, before awaiting clipboard access, to preserve user activation.
      globalThis.open(DIAGNOSTIC_FORM, '_blank', 'noopener,noreferrer');
      const copied = await copyReport();
      if (copied) get('diagnosticProgress').textContent = 'Отчёт скопирован. Вставьте его в открывшуюся форму и нажмите отправку. Если форма не открылась, используйте ссылку ниже.';
    });
    get('diagnosticDownload').addEventListener('click', () => deps.downloadBlob(new Blob([get('diagnosticText').value], { type: 'text/plain;charset=utf-8' }), 'image-format-lab-diagnostics.txt'));
    globalThis.addEventListener?.('error', event => recordDiagnosticEvent(app.diagnosticEvents ??= [], 'page', event.error ?? event.message));
    globalThis.addEventListener?.('unhandledrejection', event => recordDiagnosticEvent(app.diagnosticEvents ??= [], 'promise', event.reason));
  }
  return { diagnosticReport, openDiagnostics, attachDiagnosticEvents };
}
