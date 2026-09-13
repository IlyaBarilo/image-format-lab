import { decodeCodecEntry } from '../core/codec-payload.mjs';

// Parse once and replace packed entries with restored source after first use.
// Neither reading nor unpacking accesses files or the network.
let scripts;
function embeddedScripts() {
  if (!scripts) {
    const element = document.getElementById('embedded-codecs');
    if (!element) throw new Error('В HTML отсутствуют встроенные библиотеки. Пересоберите приложение.');
    const payload = JSON.parse(element.textContent);
    if (!payload.scripts || typeof payload.scripts !== 'object') throw new Error('Повреждён комплект встроенных библиотек.');
    scripts = payload.scripts;
  }
  return scripts;
}

export function embeddedCodecsNeedInflater() {
  return Object.values(embeddedScripts()).some(entry => typeof entry !== 'string');
}

export function embeddedCodecSource(url) {
  const entries = embeddedScripts();
  if (!Object.hasOwn(entries, url)) throw new Error('В HTML отсутствует библиотека: ' + url);
  try {
    // Cache only successful results; retries never reuse partial output.
    return entries[url] = decodeCodecEntry(entries[url], globalThis.pako?.ungzip);
  } catch (error) { throw new Error('Не удалось распаковать ' + url + ': ' + (error?.message || String(error))); }
}
