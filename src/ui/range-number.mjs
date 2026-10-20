const bindings = new WeakMap();

// Keep the existing range and its handlers as the single source of applied values.
export function bindRangeNumber(range, options = {}) {
  if (!range?.ownerDocument?.createElement) return null;
  if (bindings.has(range)) { const binding = bindings.get(range); binding.sync(); return binding; }
  const doc = range.ownerDocument, input = doc.createElement('input'), wrap = doc.createElement('span');
  const suffix = doc.createElement('span');
  wrap.className = 'range-number-control'; input.type = 'number'; input.className = 'range-number';
  suffix.className = 'range-number-unit'; suffix.textContent = options.unit ?? ''; suffix.setAttribute('aria-hidden', 'true');
  range.before(wrap); wrap.append(range, input); if (options.unit) wrap.append(suffix);
  const scale = options.scale ?? 1;
  let editing = false, signature = '';
  const label = () => typeof options.label === 'function' ? options.label() : options.label || range.getAttribute('aria-label') || 'Значение';
  const limits = () => ({ min: Number(range.min || 0), max: Number(range.max || 100), step: range.step === 'any' ? 0 : Number(range.step || 1) });
  const decimal = value => String(Number(value.toFixed(10)));
  function sync(force = false) {
    const { min, max, step } = limits(), next = [range.value, min, max, step, range.disabled].join('/');
    input.min = decimal(min * scale); input.max = decimal(max * scale); input.step = step ? decimal(step * scale) : 'any';
    input.disabled = range.disabled; input.setAttribute('aria-label', label() + ' — число');
    if (range.dataset?.knowledgeTarget && input.dataset) input.dataset.knowledgeTarget = range.dataset.knowledgeTarget;
    input.title = `${label()}: ${input.min}–${input.max}${options.unit ? ' ' + options.unit : ''}. Enter — применить, Escape — отменить ввод.`;
    if (options.output) options.output.hidden = typeof options.hideOutput === 'function' ? options.hideOutput() : options.hideOutput !== false;
    if (force || !editing || next !== signature) {
      input.value = decimal(Number(range.value) * scale); input.setCustomValidity(''); input.removeAttribute('aria-invalid'); editing = false;
    }
    signature = next;
  }
  function valid() {
    const { min, max, step } = limits(), value = Number(input.value) / scale;
    const okay = input.value.trim() !== '' && Number.isFinite(value) && value >= min && value <= max &&
      (!step || Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-7);
    input.setCustomValidity(okay ? '' : `Введите число от ${input.min} до ${input.max}${step ? ', шаг ' + input.step : ''}.`);
    if (okay) input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true');
    return okay;
  }
  function commit() {
    if (range.disabled || !valid()) return false;
    const { min, step } = limits(), raw = Number(input.value) / scale;
    const value = decimal(step ? min + Math.round((raw - min) / step) * step : raw);
    const changed = Number(range.value) !== Number(value);
    editing = false; range.value = value;
    if (changed) range.dispatchEvent(new Event('input', { bubbles: true }));
    sync(true); return true;
  }
  input.addEventListener('input', event => { event.stopPropagation(); editing = true; valid(); });
  input.addEventListener('change', event => { event.stopPropagation(); commit(); });
  input.addEventListener('blur', () => { if (!commit()) sync(true); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!commit()) input.reportValidity(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); sync(true); }
  });
  range.addEventListener('input', () => sync(true));
  range.addEventListener('change', () => sync(true));
  const binding = { input, sync }; bindings.set(range, binding); sync(true); return binding;
}
