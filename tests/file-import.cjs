// Node-only: real import/source handlers, supplied DOM events and a controlled decoder.
// This verifies state and routing, not browser hit-testing or rendered CSS.
const assert = require('node:assert/strict');

(async () => {
  const [{ createState }, { createFiles }, { createSource }, { createFileDrop }] = await Promise.all([
    import('../src/state.mjs'), import('../src/ui/files.mjs'), import('../src/ui/source.mjs'), import('../src/ui/file-drop.mjs')
  ]);
  class Element {
    constructor(parent = null, fileInput = false) {
      this.parent = parent; this.fileInput = fileInput; this.hidden = true; this.style = {};
      this.attrs = new Map(); this.events = new Map(); this.classes = new Set();
      this.classList = { remove: name => this.classes.delete(name), add: name => this.classes.add(name) };
    }
    contains(node) { for (; node; node = node.parent) if (node === this) return true; return false; }
    closest() { return this.fileInput ? this : this.parent?.closest() || null; }
    setAttribute(key, value) { this.attrs.set(key, value); }
    addEventListener(name, fn) { const handlers = this.events.get(name) || []; handlers.push(fn); this.events.set(name, handlers); }
    emit(name, values = {}) {
      const event = { target: this, clientX: 100, clientY: 100, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...values };
      for (const fn of this.events.get(name) || []) fn(event);
      return event;
    }
  }
  const doc = new Element(), win = new Element(), app = createState();
  let modal = null;
  doc.querySelector = () => modal; doc.hidden = false;
  win.innerWidth = 1440; win.innerHeight = 1000;
  globalThis.document = doc; globalThis.window = win;
  const panel = new Element(doc), listRow = new Element(panel), stage = new Element(doc), canvas = new Element(stage);
  const els = {
    workspace: new Element(), toggleFiles: new Element(), filePanel: panel, fileInput: new Element(panel, true),
    fileDropHint: new Element(), viewDropHint: new Element(), emptyState: new Element()
  };
  const statuses = [], rendered = [], opened = [];
  const decode = file => ({ file, name: file.name, width: 8, height: 4, size: file.size });
  const actions = {
    showStatus: (...args) => statuses.push(args), updateFileList() {}, updateBatchUI() {},
    updateAnalysis() {}, clearBatchPreview() {}, resetView() {}, drawAll() {},
    formatBytes: bytes => String(bytes), setEmptyState: () => { els.emptyState.style.display = 'grid'; },
    decodeSourceFile: async file => { opened.push(file.name); return decode(file); },
    renderVisibleVariants: async () => { rendered.push(app.source.name); }
  };
  Object.assign(actions, createSource({ app, els }, actions), createFiles({ app, els }, actions));
  // Row rendering needs an actual DOM and is covered by the browser suite.
  actions.updateFileList = () => {};
  createFileDrop({ app, els }, actions).attachFileDropEvents();
  const file = (name, type = 'image/png') => new File(['synthetic'], name, { type });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const selection = () => app.files.find(item => item.id === app.selectedFileId)?.name;
  const transfer = files => ({ types: ['Files'], items: files.map(() => ({ kind: 'file' })), files });
  const drop = (target, files) => doc.emit('drop', { target, dataTransfer: transfer(files) });
  const sourceConfig = JSON.stringify(app.exportConfig);

  actions.addFiles([file('first.png'), file('second.png')]); await tick();
  assert.equal(selection(), 'first.png'); assert.deepEqual(opened, ['first.png']);
  const saved = app.source;
  actions.addFiles([file('third.png'), file('fourth.png')]); await tick();
  assert.equal(app.source, saved, 'multiple list additions preserve the selected source and results');
  assert.deepEqual(opened, ['first.png']);
  actions.addFiles([file('single.png')]); await tick();
  assert.equal(selection(), 'single.png'); assert.equal(app.source.name, 'single.png');
  assert.equal(app.files.at(-1).status, 'ready'); assert.equal(rendered.at(-1), 'single.png');
  actions.addFiles([file('notes.txt', 'text/plain'), file('image.HEIC', '')]); await tick();
  assert.equal(selection(), 'image.HEIC', 'one accepted image auto-opens even among unsupported files');
  assert.match(statuses.at(-1)[0], /Пропущено.*1/);
  const before = app.files.length;
  actions.addFiles([file('notes.txt', 'text/plain')]);
  assert.equal(app.files.length, before); assert.equal(selection(), 'image.HEIC');
  assert.equal(JSON.stringify(app.exportConfig), sourceConfig);
  console.log('PASS single/multiple additions, lazy opening, unsupported types, empty MIME and preserved settings');

  // Protected drag data is not read until the actual drop.
  const protectedData = { types: ['Files'], get files() { throw new Error('files unavailable before drop'); } };
  doc.emit('dragenter', { target: stage, dataTransfer: protectedData });
  doc.emit('dragenter', { target: canvas, dataTransfer: protectedData });
  doc.emit('dragleave', { target: stage, relatedTarget: canvas });
  assert.equal(els.viewDropHint.hidden, false, 'nested drag events retain the highlight');
  assert.equal(els.fileDropHint.hidden, true); assert.equal(protectedData.dropEffect, 'copy');
  doc.emit('dragover', { target: listRow, dataTransfer: protectedData });
  assert.equal(els.fileDropHint.hidden, false); assert.equal(els.viewDropHint.hidden, true);
  assert.equal(drop(listRow, [file('list-a.png'), file('list-b.png')]).defaultPrevented, true); await tick();
  assert.equal(selection(), 'image.HEIC'); assert.equal(els.fileDropHint.hidden, true);
  drop(listRow, [file('list-single.png')]); await tick();
  assert.equal(selection(), 'list-single.png');
  els.workspace.classes.add('files-hidden');
  drop(canvas, [file('view-a.png'), file('view-b.png')]); await tick();
  assert.equal(selection(), 'view-a.png'); assert.equal(app.source.name, 'view-a.png');
  assert.deepEqual(app.files.slice(-2).map(item => item.status), ['ready', 'idle']);
  assert.equal(els.workspace.classes.has('files-hidden'), false);
  assert.equal(els.toggleFiles.attrs.get('aria-expanded'), 'true');
  drop(doc, [file('window.png')]); await tick();
  assert.equal(selection(), 'window.png');
  assert.equal(els.viewDropHint.hidden, true);
  console.log('PASS list/view/window drop routing, protected data, single selection, multi-file append and list reveal');

  const beforeBlocked = app.files.length;
  app.batchRun = { running: true };
  const blocked = doc.emit('dragover', { target: canvas, dataTransfer: transfer([file('blocked.png')]) });
  assert.equal(blocked.dataTransfer.dropEffect, 'none'); assert.equal(els.viewDropHint.hidden, true);
  assert.equal(drop(canvas, [file('blocked.png')]).defaultPrevented, true);
  assert.equal(app.files.length, beforeBlocked); assert.match(statuses.at(-1)[0], /завершения пакета/);
  app.batchRun = null; modal = new Element(doc);
  assert.equal(drop(canvas, [file('modal.png')]).defaultPrevented, true);
  assert.equal(app.files.length, beforeBlocked);
  const otherInput = new Element(modal, true);
  const native = doc.emit('dragover', { target: otherInput, dataTransfer: transfer([file('profile.json', 'application/json')]) });
  assert.equal(native.defaultPrevented, false);
  assert.equal(drop(otherInput, [file('profile.json', 'application/json')]).defaultPrevented, false);
  modal = null;
  const text = doc.emit('drop', { target: canvas, dataTransfer: { types: ['text/plain'], files: [] } });
  assert.equal(text.defaultPrevented, false);
  drop(canvas, []); assert.equal(app.files.length, beforeBlocked);
  assert.equal(app.source.name, 'window.png');
  for (const cancel of [
    () => doc.emit('dragleave', { target: doc, clientX: 0, clientY: 0 }),
    () => doc.emit('dragend'), () => doc.emit('keydown', { key: 'Escape' }), () => win.emit('blur'),
    () => { doc.hidden = true; doc.emit('visibilitychange'); doc.hidden = false; }
  ]) {
    doc.emit('dragenter', { target: canvas, dataTransfer: protectedData });
    assert.equal(els.viewDropHint.hidden, false); cancel();
    assert.equal(els.viewDropHint.hidden, true); assert.equal(els.fileDropHint.hidden, true);
  }
  console.log('PASS batch/modal blocking, native file inputs, text drops and highlight cleanup');

  let release;
  actions.decodeSourceFile = file => file.name === 'slow.png'
    ? new Promise(resolve => { release = () => resolve(decode(file)); }) : Promise.resolve(decode(file));
  drop(canvas, [file('slow.png')]);
  drop(canvas, [file('latest.png')]); await tick();
  const latest = app.source; release(); await tick();
  assert.equal(app.source, latest); assert.equal(selection(), 'latest.png'); assert.equal(rendered.at(-1), 'latest.png');
  let reject;
  actions.decodeSourceFile = file => file.name === 'bad.png'
    ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve(decode(file));
  drop(canvas, [file('bad.png')]); drop(canvas, [file('newest.png')]); await tick();
  reject(new Error('old failure')); await tick();
  assert.equal(app.source.name, 'newest.png'); assert.equal(app.sourceError, '');
  assert.equal(app.files.at(-1).status, 'ready'); assert.equal(rendered.at(-1), 'newest.png');
  console.log('PASS late decoding success/failure cannot overwrite the most recently dropped source');
})().catch(error => { console.error(error); process.exitCode = 1; });
