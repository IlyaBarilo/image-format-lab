const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {};
    this.textContent = ''; this.value = ''; this.disabled = false;
    this.isConnected = true; this.open = false; this.attributes = new Set();
    this.hidden = false; this.style = {};
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  emit(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  setAttribute(name, value) { this[name] = value; this.attributes.add(name); }
  getAttribute(name) { return this.attributes.has(name) ? this[name] : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  matches(selector) { return selector === 'button, a' && ['button', 'a'].includes(this.tag); }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 100 }; }
  click() { this.emit('click'); }
  closest(selector) {
    if (selector === '[hidden], .hidden') return this.hidden ? this : null;
    if (selector === '[data-knowledge-target]' && this.dataset.knowledgeTarget) return this;
    if (selector === '[data-knowledge-analysis-select]' && this.dataset.knowledgeAnalysisSelect) return this;
    if (selector === '[data-knowledge-format-select]' && this.dataset.knowledgeFormatSelect) return this;
    return null;
  }
  querySelector(selector) {
    const id = selector.slice(1);
    for (const child of this.children) {
      if (child.id === id) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
  focus() { global.document.activeElement = this; }
  scrollIntoView() { global.lastScrolledElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8');
  const payload = html.match(/id="embedded-knowledge">([\s\S]*?)<\/script>/)[1];
  const nodes = new Map(), events = {}, windowEvents = {};
  let otherDialog = null;
  const get = id => {
    if (!nodes.has(id)) { const element = new Element(); element.id = id; nodes.set(id, element); }
    return nodes.get(id);
  };
  get('embedded-knowledge').textContent = payload;
  get('knowledgeDialog').showModal = Element.prototype.showModal;
  get('knowledgeDialog').close = Element.prototype.close;
  global.document = {
    activeElement: null,
    getElementById: get,
    createElement: tag => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag),
    createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; },
    querySelector(selector) { return selector.startsWith('dialog') ? otherDialog : get('formatSelect'); },
    addEventListener(name, fn) { events[name] = fn; }
  };
  global.requestAnimationFrame = fn => fn();
  global.window = { innerWidth: 1200, innerHeight: 800 };
  global.location = { hash: '#help=crop-source' };
  global.addEventListener = (name, fn) => { windowEvents[name] = fn; };
  const { createKnowledge } = await import('../src/ui/knowledge.mjs');
  createKnowledge().attachKnowledgeEvents();
  assert.match(get('knowledgeCurrent').textContent, /Действия по шагам/);
  get('knowledgeDialog').close();
  assert.match(get('wipeMode').title, /границей/);
  assert.match(get('analysisPNG')['aria-description'], /графики/);
  const opener = new Element('button'); opener.dataset.knowledgeTarget = 'formats/jpeg#parameters';
  document.activeElement = opener;
  events.click({ target: opener, preventDefault() {} });
  assert.equal(get('knowledgeDialog').open, true);
  assert.match(get('knowledgeCurrent').textContent, /JPEG/);
  assert.equal(get('knowledgeBack').disabled, true);
  const article = get('knowledgeContent');
  assert.equal(article.children[0].textContent, 'JPEG');
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const chroma = descendants(article).find(node => node.className === 'knowledge-inline-link' && /Цветность/.test(node.textContent));
  assert.ok(chroma, 'internal related-topic link is rendered');
  chroma.emit('click');
  assert.match(get('knowledgeCurrent').textContent, /Цветность/);
  assert.ok(descendants(article).some(node => node.className === 'knowledge-diagram'));
  assert.equal(get('knowledgeBack').disabled, false);
  get('knowledgeBack').emit('click');
  assert.match(get('knowledgeCurrent').textContent, /JPEG/);
  get('knowledgeSearch').value = 'TIFF'; get('knowledgeSearch').emit('input');
  assert.ok(descendants(get('knowledgeIndex')).some(node => node.textContent === 'TIFF'));
  get('knowledgeDialog').close();
  assert.equal(document.activeElement, opener, 'closing returns focus to the invoking button');
  const batch = new Element('button'); batch.dataset.knowledgeFormatSelect = 'batchFormat';
  get('batchFormat').value = 'bmp';
  events.click({ target: batch, preventDefault() {} });
  assert.match(get('knowledgeCurrent').textContent, /BMP/);
  get('knowledgeDialog').close();
  const modeHelp = new Element('button'); modeHelp.dataset.knowledgeAnalysisSelect = 'analysisType';
  get('analysisType').value = 'ssim';
  events.click({ target: modeHelp, preventDefault() {} });
  assert.match(get('knowledgeCurrent').textContent, /SSIM/);
  get('knowledgeDialog').close();
  const layout = new Element('button'); layout.dataset.knowledgeTarget = 'workflow/comparison#layout';
  layout.setAttribute('data-knowledge-keyboard-only', '');
  events.click({ target: layout, preventDefault() { throw new Error('Action button click was intercepted'); } });
  assert.equal(get('knowledgeDialog').open, false);
  const colorLink = new Element('button'); colorLink.dataset.knowledgeTarget = 'analysis/color#cie-xy';
  events.click({ target: colorLink, preventDefault() {} });
  const term = descendants(article).find(node => node.className === 'knowledge-term' && /D65/.test(node['aria-label']));
  assert.ok(term, 'a short definition is rendered as a distinct term');
  term.emit('click');
  assert.equal(term.getAttribute('aria-expanded'), 'true');
  let termEscape = false;
  events.keydown({ key: 'Escape', preventDefault() { termEscape = true; } });
  assert.equal(termEscape, true);
  assert.equal(term.getAttribute('aria-expanded'), 'false');
  get('knowledgeDialog').close();
  document.activeElement = get('analysisType');
  let modeF1 = false;
  events.keydown({ key: 'F1', preventDefault() { modeF1 = true; } });
  assert.equal(modeF1, true);
  assert.match(get('knowledgeCurrent').textContent, /SSIM/);
  get('knowledgeDialog').close();
  const field = new Element('select'); field.dataset.knowledgeTarget = 'concepts/alpha#matte';
  document.activeElement = field;
  let prevented = false;
  events.keydown({ key: 'F1', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(get('knowledgeCurrent').textContent, /Прозрачность/);
  get('knowledgeDialog').close();
  get('analysisBody').hidden = true;
  let revealCount = 0;
  get('analysisBalance').addEventListener('click', () => { revealCount++; get('analysisBody').hidden = false; });
  const settings = { scope: 'viewport', format: 'jpeg', quality: 85 };
  get('analysisScope').value = settings.scope;
  function operation(code) {
    global.location.hash = '#help=' + code;
    windowEvents.hashchange();
    const section = get('knowledgeContent').querySelector('#knowledge-workflow-operations-' + code);
    return section.children.find(node => node.className === 'text-btn knowledge-show');
  }
  operation('crop-source').click();
  assert.equal(get('knowledgeDialog').open, false);
  assert.equal(revealCount, 1);
  assert.equal(document.activeElement, get('analysisScope'));
  assert.equal(get('analysisScope').value, settings.scope, 'help never applies a region');
  assert.equal(get('analysisScope').classList.contains('knowledge-highlight'), true);
  events.keydown({ key: 'Escape' });
  assert.equal(get('knowledgeGuide').hidden, true);
  assert.equal(get('analysisScope').classList.contains('knowledge-highlight'), false);
  get('analysisLineOpen').hidden = true;
  operation('analysis-line').click();
  assert.equal(document.activeElement, get('analysisType'));
  assert.match(get('knowledgeGuideText').textContent, /Сначала выберите/);
  assert.equal(get('analysisType').value, 'ssim', 'help never changes graph type');
  get('knowledgeGuideClose').click();
  get('analysisPNG').disabled = true;
  operation('export-graph').click();
  assert.match(get('knowledgeGuideText').textContent, /Дождитесь/);
  get('knowledgeGuideClose').click();
  otherDialog = new Element('dialog');
  global.location.hash = '#help=view-layout'; windowEvents.hashchange();
  assert.equal(get('knowledgeDialog').open, false, 'address help waits for another dialog');
  otherDialog = null; events.close();
  assert.equal(get('knowledgeDialog').open, true);
  const contentBefore = get('knowledgeContent').children;
  global.location.hash = '#help=missing'; windowEvents.hashchange();
  assert.equal(get('knowledgeContent').children, contentBefore, 'unknown hash is ignored');
  get('knowledgeSearch').value = 'analysis-line'; get('knowledgeSearch').emit('input');
  const codeResult = descendants(get('knowledgeIndex')).find(node => node.className === 'knowledge-index-link');
  assert.equal(codeResult.textContent, 'Действия по шагам');
  codeResult.click();
  assert.ok(get('knowledgeContent').querySelector('#knowledge-workflow-operations-analysis-line'));
  assert.equal(global.lastScrolledElement.id, 'knowledge-workflow-operations-analysis-line');
  get('analysisType').value = 'floatSource'; get('analysisScope').hidden = true;
  operation('crop-source').click();
  assert.equal(document.activeElement, get('analysisType'));
  assert.match(get('knowledgeGuideText').textContent, /Гистограмму/);
  assert.equal(get('analysisType').value, 'floatSource');
  operation('view-layout');
  assert.equal(get('analysisType').classList.contains('knowledge-highlight'), false, 'opening help clears an earlier guide');
  otherDialog = new Element('dialog');
  const blocked = get('knowledgeContent').querySelector('#knowledge-workflow-operations-view-layout').children.find(node => node.className === 'text-btn knowledge-show');
  blocked.click();
  assert.match(get('knowledgeActionStatus').textContent, /другое окно/);
  assert.equal(get('knowledgeDialog').open, true);
  otherDialog = null;
  get('knowledgeDialog').close();
  console.log('PASS contextual links, term hints, central control hints, diagrams, search, back, F1 and focus');
  console.log('PASS address help, reveal without parameter changes, hidden/disabled controls, Escape and deferred dialogs');
})().catch(error => { console.error(error); process.exitCode = 1; });
