// Deterministic ZIP for the explicit gifenc input list. Own code: MIT.
const { deflateRawSync } = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function sourceZip(files) {
  const local = [], directory = [], names = new Set();
  let offset = 0;
  for (const { name, bytes } of files) {
    if (!name || /[\\:\x00]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..') || names.has(name)) throw new Error('Invalid source ZIP path: ' + name);
    names.add(name);
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes, { level: 9 }), crc = crc32(bytes);
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12); // Fixed ZIP epoch: 1980-01-01, 00:00:00
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4);
    header.copy(central, 6, 4, 30); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed); directory.push(central, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const index = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
module.exports = { sourceZip };
