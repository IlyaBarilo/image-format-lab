const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), folder = path.join(__dirname, 'fixtures/tiff');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
(async () => {
  const { createJpegDecoder } = await import('../src/core/jpeg.mjs');
  const { installTiffJpeg } = await import('../src/core/tiff-jpeg.mjs');
  const { validateTiff, tiffRgba } = await import('../src/core/tiff.mjs');
  const factory = require('../vendor/jpeg-decoder.js');
  const codec = await factory({ print() {}, printErr() {} });
  const decode = createJpegDecoder(codec);
  assert.equal(codec.UTF8ToString(codec._viewer_jpeg_version()), '3.2.0');
  for (const item of manifest.rawCases) {
    const actual = decode(new Uint8Array(fs.readFileSync(path.join(folder, item.file))), true);
    for (const key of ['width','height','components','precision']) assert.equal(actual[key], item[key], item.name + ': ' + key);
    assert.equal(actual.lossless, true);
    assert.deepEqual([...actual.samples], item.samples, item.name + ': lossless sample values');
  }
  console.log('PASS ' + manifest.rawCases.length + ' independently encoded SOF3 cases: predictors, point transform, restart, precision and components');
  const sandbox = { console, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView };
  sandbox.self = sandbox; sandbox.window = sandbox; const context = vm.createContext(sandbox);
  for (const name of ['pako-2.1.0.min.js','UPNG-2.1.0.js']) vm.runInContext(fs.readFileSync(path.join(root, 'vendor', name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/sources/utif/UTIF.js'), 'utf8'), context);
  assert.equal(sandbox.UTIF.JpegDecoder, undefined); assert.equal(sandbox.UTIF.LosslessJpegDecode, undefined);
  installTiffJpeg(sandbox.UTIF, decode);
  const rawTiff = buffer(fs.readFileSync(path.join(folder, 'raw-two-components.tiff')));
  const rawIfds = sandbox.UTIF.decode(rawTiff), rawIfd = rawIfds[0];
  sandbox.UTIF.decodeImage(rawTiff, rawIfd, rawIfds);
  const referenceRaw = manifest.rawCases.find(item => item.name === 'two-components');
  const strideRaw = Math.ceil(rawIfd.width * 14 / 8), unpacked = [];
  for (let y=0;y<rawIfd.height;y++) for (let x=0;x<rawIfd.width;x++) {
    let value=0;
    for(let b=0;b<14;b++){const at=x*14+b;value=value*2+((rawIfd.data[y*strideRaw+(at>>3)]>>(7-(at&7)))&1);}
    unpacked.push(value);
  }
  assert.deepEqual(unpacked, referenceRaw.samples, 'DNG-like two-component samples and padded rows preserved');
  for (const item of manifest.cases) {
    const source = fs.readFileSync(path.join(folder, item.file));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), item.sha256);
    const input = buffer(source); validateTiff(input);
    const ifds = sandbox.UTIF.decode(input), ifd = ifds[0];
    sandbox.UTIF.decodeImage(input, ifd, ifds);
    const actual = tiffRgba(ifd, sandbox.UTIF.toRGBA8);
    const expected = new Uint8Array(sandbox.UPNG.toRGBA8(sandbox.UPNG.decode(buffer(fs.readFileSync(path.join(folder, item.expected)))))[0]);
    assert.equal(actual.length, expected.length, item.name + ': dimensions');
    let max = 0;
    for (let i = 0; i < actual.length; i++) max = Math.max(max, Math.abs(actual[i] - expected[i]));
    assert.ok(max <= 1, item.name + ': maximum channel difference ' + max + '; first=' + [...actual.slice(0,8)] + '/' + [...expected.slice(0,8)] + '; last=' + [...actual.slice(-4)] + '/' + [...expected.slice(-4)]);
    console.log('PASS TIFF ' + item.name + ' (max difference ' + max + ')');
  }
  const good = new Uint8Array(fs.readFileSync(path.join(folder, 'baseline.jpg')));
  for (const bad of [good.slice(0,30),good.slice(0,good.length-20),Uint8Array.of(255,216,255,217)]) {
    assert.throws(() => decode(bad));
    assert.equal(decode(good).width,37);
  }
  const large = good.slice();
  for (let i=2;i<large.length-8;) {
    const code=large[i+1], length=(large[i+2]<<8)|large[i+3];
    if (code===192) { large.set([39,16,39,16],i+5); break; }
    i+=length+2;
  }
  assert.throws(() => decode(large), /40 megapixels/);
  const malformed = buffer(fs.readFileSync(path.join(folder,'baseline.tiff'))), view=new DataView(malformed);
  view.setUint32(4,0xfffffff0,true);
  assert.throws(() => validateTiff(malformed));
  view.setUint32(4,0,true);
  assert.throws(() => validateTiff(malformed), /не содержит/);
  const duplicatePayload=new ArrayBuffer(1024*1024+200), fields=new DataView(duplicatePayload);
  fields.setUint16(0,0x4949);fields.setUint16(2,42,true);fields.setUint32(4,8,true);fields.setUint16(8,9,true);
  for(let i=0;i<9;i++){
    const at=10+i*12;fields.setUint16(at,65000+i,true);fields.setUint16(at+2,1,true);
    fields.setUint32(at+4,1024*1024,true);fields.setUint32(at+8,200,true);
  }
  assert.throws(() => validateTiff(duplicatePayload), /Слишком много/);
  assert.throws(() => tiffRgba({ t258: [12,12], t262: [1], t277: [2], width: 1, height: 1, data: new Uint8Array(3) }, () => {}), /дополнительных каналов/);
  assert.throws(() => tiffRgba({ t258: [12,14,12], t262: [2], t277: [3], width: 1, height: 1, data: new Uint8Array(5) }, () => {}), /одинаковой разрядностью/);
  console.log('PASS corrupt/oversized JPEG and TIFF rejected; next decode recovers; old decoders absent');
})().catch(error => { console.error(error); process.exitCode=1; });
