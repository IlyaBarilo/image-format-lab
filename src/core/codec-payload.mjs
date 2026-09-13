// Reversible storage for executable codecs; source archives and notices are separate.
export function decodeCodecEntry(entry, ungzip) {
  if (typeof entry === 'string') return entry;
  if (entry?.encoding !== 'gzip-base64' || typeof entry.data !== 'string' ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 64 * 1024 * 1024) {
    throw new Error('Повреждён блок встроенного кодека');
  }
  if (typeof ungzip !== 'function') throw new Error('Распаковщик встроенных кодеков не запущен');
  let packed;
  if (typeof Uint8Array.fromBase64 === 'function') packed = Uint8Array.fromBase64(entry.data);
  else {
    const text = atob(entry.data);
    packed = new Uint8Array(text.length);
    // Avoid Uint8Array.from(string, callback): it is costly for large modules.
    for (let i = 0; i < text.length; i++) packed[i] = text.charCodeAt(i);
  }
  const bytes = ungzip(packed); // pako verifies the gzip checksum.
  if (bytes.byteLength !== entry.bytes) throw new Error('Неверный размер распакованного кодека');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
