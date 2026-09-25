// Independent container fixtures. JPEG entropy is intentionally not decoded.
const zlib = require('node:zlib');
function chunk(name, input = []) {
  const bytes = Buffer.from(input), result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); result.write(name, 4, 'ascii'); bytes.copy(result, 8);
  let crc = -1;
  for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  result.writeUInt32BE((crc ^ -1) >>> 0, result.length - 4); return result;
}
function png({ width = 3, height = 2, depth = 8, type = 6, interlace = 0, before = [], after = [] } = {}) {
  const head = Buffer.alloc(13); head.writeUInt32BE(width); head.writeUInt32BE(height, 4); head[8] = depth; head[9] = type; head[12] = interlace;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = Buffer.alloc((1 + Math.ceil(width * channels * depth / 8)) * height);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', head), ...before, chunk('IDAT', zlib.deflateSync(raw)), ...after, chunk('IEND')]);
}
const segment = (marker, payload) => { const p = Buffer.from(payload), out = Buffer.alloc(p.length + 4); out[0] = 255; out[1] = marker; out.writeUInt16BE(p.length + 2, 2); p.copy(out, 4); return out; };
function jpeg({ width = 16, height = 8, depth = 8, mode = 192, ids = [1,2,3], sampling = [0x22,0x11,0x11], jfif = true, adobe = null, before = [], after = [], entropy = Buffer.from([1,2,255,0,3,255,208,4]), scans = 1, dnl = null } = {}) {
  const sof = Buffer.alloc(6 + ids.length * 3); sof[0] = depth; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3); sof[5] = ids.length;
  ids.forEach((id, n) => { sof[6 + n * 3] = id; sof[7 + n * 3] = sampling[n]; });
  const sos = Buffer.from([ids.length, ...ids.flatMap(id => [id, 0]), 0, 63, 0]);
  const parts = [Buffer.from([255,216])];
  if (jfif) parts.push(segment(224, [74,70,73,70,0,1,1,0,0,1,0,1,0,0]));
  if (adobe !== null) parts.push(segment(238, [65,100,111,98,101,0,100,0,0,0,0,adobe]));
  parts.push(...before, segment(mode, sof));
  for (let n = 0; n < scans; n++) parts.push(segment(218, sos), entropy);
  if (dnl !== null) parts.push(segment(220, [dnl >> 8, dnl & 255]), Buffer.from([1,2,3]));
  parts.push(...after, Buffer.from([255,217])); return Buffer.concat(parts);
}
const exif = Buffer.from([73,73,42,0,8,0,0,0,0,0,0,0,0,0]);
module.exports = { chunk, png, segment, jpeg, exif };
