export function reconstructionName(name, operation) {
  const base = String(name || 'image').replace(/\.(jpe?g|jxl)$/i, '').slice(0, 160) || 'image';
  return operation === 'jpeg-to-jxl' ? `${base}-jpeg-reconstruction.jxl` : `${base}-restored.jpg`;
}

export async function sameBlobBytes(left, right) {
  if (left.size !== right.size) return false;
  const chunk = 1024 * 1024;
  for (let offset = 0; offset < left.size; offset += chunk) {
    const [a, b] = await Promise.all([
      left.slice(offset, offset + chunk).arrayBuffer(),
      right.slice(offset, offset + chunk).arrayBuffer()
    ]);
    const first = new Uint8Array(a), second = new Uint8Array(b);
    for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) return false;
  }
  return true;
}
