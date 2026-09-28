const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {};
    this.textContent = ''; this.value = ''; this.disabled = false;
    this.isConnected = true; this.open = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  emit(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  setAttribute(name, value) { this[name] = value; }
  matches(selector) { return selector === 'button, a' && ['button', 'a'].includes(this.tag); }
  closest(selector) {
    if (selector === '[data-knowledge-target]' && this.dataset.knowledgeTarget) return this;
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
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8');
  const payload = html.match(/id="embedded-knowledge">([\s\S]*?)<\/script>/)[1];
  const nodes = new Map(), events = {};
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  get('embedded-knowledge').textContent = payload;
  get('knowledgeDialog').showModal = Element.prototype.showModal;
  get('knowledgeDialog').close = Element.prototype.close;
  global.document = {
    activeElement: null,
    getElementById: get,
    createElement: tag => new Element(tag),
    createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; },
    addEventListener(name, fn) { events[name] = fn; }
  };
  global.requestAnimationFrame = fn => fn();
  const { createKnowledge } = await import('../src/ui/knowledge.mjs');
  createKnowledge().attachKnowledgeEvents();
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
  const field = new Element('select'); field.dataset.knowledgeTarget = 'concepts/alpha#matte';
  document.activeElement = field;
  let prevented = false;
  events.keydown({ key: 'F1', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(get('knowledgeCurrent').textContent, /Прозрачность/);
  console.log('PASS contextual links, related topics, search, back, batch format, F1 and focus restoration');
})().catch(error => { console.error(error); process.exitCode = 1; });
