const assert = require('node:assert/strict');
(async () => {
  const { bindRangeNumber } = await import('../src/ui/range-number.mjs');
  class Element extends EventTarget {
    constructor(doc) { super(); this.ownerDocument = doc; this.attrs = {}; this.value = ''; this.min = ''; this.max = ''; this.step = ''; this.disabled = false; this.children = []; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { this.reported = true; }
    before(wrap) { this.wrap = wrap; }
    append(...children) { this.children.push(...children); }
  }
  const doc = { createElement: () => new Element(doc) };
  const range = new Element(doc), output = new Element(doc);
  Object.assign(range, { min: '1', max: '100', step: '1', value: '85' });
  let applications = 0; range.addEventListener('input', () => applications++);
  const binding = bindRangeNumber(range, { output, label: 'Качество кодирования' }), input = binding.input;
  const fire = (name, key) => { const event = new Event(name, { cancelable: true }); if (key) Object.defineProperty(event, 'key', { value: key }); input.dispatchEvent(event); return event; };
  const type = value => { input.value = value; fire('input'); };
  assert.equal(input.value, '85'); assert.equal(output.hidden, true);
  type('3'); assert.equal(range.value, '85'); assert.equal(applications, 0);
  binding.sync(); assert.equal(input.value, '3', 'unrelated refresh must retain a draft');
  type('30'); const enter = fire('keydown', 'Enter'); assert.equal(enter.defaultPrevented, true);
  assert.equal(range.value, '30'); assert.equal(applications, 1);
  fire('change'); fire('blur'); assert.equal(applications, 1, 'one commit must dispatch one recalculation');
  for (const value of ['', 'NaN', '0', '101', '30.5']) {
    type(value); fire('keydown', 'Enter'); assert.equal(applications, 1); assert.ok(input.validationMessage); assert.equal(range.value, '30');
    fire('keydown', 'Escape'); assert.equal(input.value, '30'); assert.equal(input.validationMessage, '');
  }
  type('50'); fire('blur'); assert.equal(range.value, '50'); assert.equal(applications, 2);
  type('999'); fire('blur'); assert.equal(input.value, '50'); assert.equal(input.validationMessage, '');
  range.value = '90'; range.dispatchEvent(new Event('input')); assert.equal(input.value, '90');
  range.min = '0'; range.max = '6'; range.value = '4'; binding.sync();
  assert.equal(input.max, '6'); assert.equal(input.value, '4');
  type('7'); fire('change'); assert.equal(range.value, '4');
  range.min = '1'; range.max = '10'; range.value = '5'; binding.sync();
  assert.equal(input.max, '10'); assert.equal(input.min, '1'); assert.equal(input.value, '5');
  range.disabled = true; binding.sync(); assert.equal(input.disabled, true);
  const before = applications; type('9'); fire('change'); assert.equal(applications, before);
  assert.equal(bindRangeNumber(range), binding); assert.equal(range.wrap.children.length, 2);
  const position = new Element(doc); Object.assign(position, { min: '0', max: '1000', step: '1', value: '500' });
  const percent = bindRangeNumber(position, { scale: .1, unit: '%', label: 'Позиция' }).input;
  percent.value = '12.3'; percent.dispatchEvent(new Event('change')); assert.equal(position.value, '123'); assert.equal(percent.step, '0.1');
  const exposure = new Element(doc); Object.assign(exposure, { min: '-3', max: '3', step: '.25', value: '0' });
  const ev = bindRangeNumber(exposure, { label: 'Экспозиция', unit: 'EV' }).input;
  ev.value = '-1.25'; ev.dispatchEvent(new Event('change')); assert.equal(exposure.value, '-1.25');
  ev.value = '-1.2'; ev.dispatchEvent(new Event('change')); assert.equal(exposure.value, '-1.25'); assert.ok(ev.validationMessage);
  console.log('PASS typed drafts, single commit, Enter/blur/Escape, limits, dynamic codecs, disabled fields, percentages and decimal exposure');
})().catch(error => { console.error(error); process.exitCode = 1; });
