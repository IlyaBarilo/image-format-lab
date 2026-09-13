const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    emit(type, event = {}) { for (const fn of listeners.get(type) || []) fn(event); },
    count(type) { return (listeners.get(type) || []).length; }
  };
}
function environment({ saved = null, dark = false, denied = false, noMedia = false, beforeBody = false } = {}) {
  const values = new Map(saved === null ? [] : [['image-format-viewer.theme.v1', saved]]);
  const writes = [];
  const button = { ...events(), attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const media = { ...events(), matches: dark };
  const window = {
    ...events(),
    get localStorage() {
      if (denied) throw new Error('Storage access denied');
      return {
        getItem(key) { return values.get(key) ?? null; },
        removeItem(key) { values.delete(key); },
        setItem(key, value) { values.set(key, value); writes.push([key, value]); }
      };
    },
    matchMedia(query) { assert.equal(query, '(prefers-color-scheme: dark)'); if (noMedia) throw new Error('Unavailable'); return media; }
  };
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) { assert.ok(!beforeBody, 'startup must not depend on body elements'); assert.equal(id, 'themeToggle'); return button; }
  };
  return { window, document, button, media, values, writes };
}

(async () => {
  const { applyInitialTheme, createTheme, THEME_STORAGE_KEY } = await import('../src/ui/theme.mjs');
  const use = options => { const env = environment(options); global.window = env.window; global.document = env.document; return env; };
  for (const [options, expected] of [
    [{}, 'light'], [{ dark: true }, 'dark'], [{ saved: 'light', dark: true }, 'light'],
    [{ saved: 'dark' }, 'dark'], [{ saved: 'invalid', dark: true }, 'dark'],
    [{ denied: true, dark: true }, 'dark'], [{ noMedia: true }, 'light'],
    [{ noMedia: true, saved: 'dark' }, 'dark']
  ]) {
    const env = use({ ...options, beforeBody: true });
    applyInitialTheme();
    assert.equal(env.document.documentElement.dataset.theme, expected);
    assert.equal(env.writes.length, 0, 'system defaults must not become a saved preference');
  }
  console.log('PASS first paint: saved choice, system default, corrupt/unavailable storage and media fallback');

  let env = use({ dark: true });
  const controller = createTheme();
  controller.attachThemeEvents(); controller.attachThemeEvents();
  assert.equal(env.button.count('click'), 1);
  assert.equal(env.button.attrs['aria-pressed'], 'true');
  assert.equal(env.button.title, 'Включить светлую тему');
  env.media.matches = false; env.media.emit('change');
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  assert.equal(env.writes.length, 0);
  env.button.emit('click');
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  assert.deepEqual(env.writes, [[THEME_STORAGE_KEY, 'dark']]);
  env.media.emit('change');
  assert.equal(env.document.documentElement.dataset.theme, 'dark', 'explicit choice overrides later system changes');
  env.button.emit('click');
  assert.equal(env.button.attrs['aria-pressed'], 'false');
  assert.equal(env.button.title, 'Включить тёмную тему');
  assert.deepEqual(env.writes[1], [THEME_STORAGE_KEY, 'light']);
  const saved = env.values.get(THEME_STORAGE_KEY);
  const reopened = use({ saved, dark: true });
  createTheme().attachThemeEvents();
  assert.equal(reopened.document.documentElement.dataset.theme, 'light', 'new session restores the saved choice');
  console.log('PASS toggle, accessible state, isolated preference, persistence and system-change priority');

  env = use({ dark: true }); createTheme().attachThemeEvents();
  env.values.set(THEME_STORAGE_KEY, 'light');
  env.window.emit('storage', { key: 'image-format-viewer.batch-settings.v1' });
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  env.window.emit('storage', { key: THEME_STORAGE_KEY });
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  env.values.clear(); env.window.emit('storage', { key: null });
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  env.values.set(THEME_STORAGE_KEY, 'invalid'); env.media.matches = false;
  env.window.emit('storage', { key: THEME_STORAGE_KEY });
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  env = use({ denied: true }); createTheme().attachThemeEvents(); env.button.emit('click');
  env.media.emit('change');
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  assert.equal(env.button.attrs['aria-pressed'], 'true');
  console.log('PASS storage synchronization, clearing, unrelated keys and session-only fallback');

  env=use({saved:'light',dark:true});const resettable=createTheme();resettable.attachThemeEvents();
  assert.equal(resettable.resetTheme(),true);assert.equal(env.document.documentElement.dataset.theme,'dark');
  assert.equal(env.values.has(THEME_STORAGE_KEY),false);assert.equal(env.button.attrs['aria-pressed'],'true');
  env.media.matches=false;env.media.emit('change');assert.equal(env.document.documentElement.dataset.theme,'light');
  env=use({denied:true});const blockedReset=createTheme();blockedReset.attachThemeEvents();env.button.emit('click');
  assert.equal(blockedReset.resetTheme(),false);assert.equal(env.document.documentElement.dataset.theme,'light');
  console.log('PASS reset restores the system theme, removes only its key and works on screen if storage is denied');

  const html = fs.readFileSync(path.join(__dirname, '../image-format-lab.html'), 'utf8');
  const startup = html.match(/<script id="viewer-theme">([\s\S]*?)<\/script>/);
  assert.ok(startup && startup.index < html.indexOf('<style>') && startup.index < html.indexOf('<body>'));
  for (const [options, expected] of [[{ saved: 'dark' }, 'dark'], [{ saved: 'light', dark: true }, 'light'], [{ saved: 'invalid', dark: true }, 'dark'], [{ denied: true, dark: true }, 'dark'], [{ denied: true, noMedia: true }, 'light']]) {
    const { window, document } = environment({ ...options, beforeBody: true });
    vm.runInNewContext(startup[1], { window, document });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  console.log('PASS actual bundled startup executes before CSS/body without external APIs or imports');

  const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
  const palette = Object.fromEntries([...css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
  function luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  function contrast(fg, bg) { const a = luminance(palette[fg]), b = luminance(palette[bg]); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
  for (const bg of ['bg', 'panel', 'panel-soft', 'control-bg', 'selected-bg', 'selection-bg', 'cell-head']) {
    for (const fg of ['text', 'muted', 'accent', 'bad', 'warn']) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}`);
  }
  for (const [fg, bg] of [['on-accent', 'accent'], ['on-accent', 'accent-strong'], ['scope-first', 'panel'], ['scope-second', 'panel'], ['bad', 'danger-soft']]) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
  console.log('PASS dark palette text contrast >= 4.5:1 for tested solid surfaces, states and legends');
})().catch(error => { console.error(error); process.exitCode = 1; });
