const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pages = ['image-format-lab.html'];
if (fs.existsSync(path.join(root, 'image-format-converter.html'))) pages.push('image-format-converter.html');
else console.log('SKIP historical converter: absent from the public project; local/ is not used');
class ImageData {
  constructor(data, width, height) { Object.assign(this, { data, width, height }); }
}
globalThis.ImageData = ImageData;
async function context(file) {
  if (file === 'image-format-lab.html') {
    // The current viewer is tested through its real ES-module exports.
    // The historical converter below keeps its existing inline-script checks.
    const [gif, bmp, metrics, codecs] = await Promise.all([
      import('../src/core/gif.mjs'), import('../src/core/bmp.mjs'),
      import('../src/core/metrics.mjs'), import('../src/services/codecs.mjs')
    ]);
    const app = { codecs: {}, codecPromises: {}, codecAttempts: {}, scriptPromises: new Map() };
    const ctx = vm.createContext({ console, Blob, URL, ImageData, Uint8Array, Uint8ClampedArray, setTimeout, clearTimeout, app, ...gif, ...bmp, ...metrics });
    const dependencies = { get loadScript() { return ctx.loadScript; }, updateCodecStatus() {}, updateFormatOptions() {} };
    ctx.loadOptionalCodec = codecs.createCodecs({ app, els: {} }, dependencies).loadOptionalCodec;
    return ctx;
  }
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\binit\(\);\s*$/, '');
  const ctx = vm.createContext({ document: { getElementById: () => ({}) }, console,
    Blob, URL, ImageData, Uint8Array, Uint8ClampedArray, setTimeout, clearTimeout });
  vm.runInContext(source, ctx, { filename: file });
  return ctx;
}
function pixels(width, height, alpha = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 123456789;
  for (let p = 0; p < width * height; p++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data.set([seed & 255, (seed >>> 8) & 255, seed >>> 24, alpha ? (p % 3) * 127 : 255], p * 4);
  }
  return { width, height, imageData: new ImageData(data, width, height), hasAlpha: alpha };
}
// Independent GIF LZW reader: require the end code, including at width boundaries.
function decodeLzw(bytes, minimum) {
  const clear = 1 << minimum, end = clear + 1;
  let dictionary, size, next, previous, position = 0;
  const output = [];
  const reset = () => { dictionary = Array.from({ length: clear }, (_, i) => [i]); size = minimum + 1; next = end + 1; previous = null; };
  reset();
  while (position + size <= bytes.length * 8) {
    let code = 0;
    for (let bit = 0; bit < size; bit++, position++) code |= ((bytes[position >> 3] >> (position & 7)) & 1) << bit;
    if (code === clear) { reset(); continue; }
    if (code === end) return output;
    const entry = dictionary[code] || (code === next && previous ? [...previous, previous[0]] : null);
    assert.ok(entry, `invalid LZW code ${code}`);
    output.push(...entry);
    if (previous && next < 4096) {
      dictionary[next++] = [...previous, entry[0]];
      if (next === 1 << size && size < 12) size++;
    }
    previous = entry;
  }
  throw new Error('missing complete GIF end code');
}
let failed = 0;
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
(async () => {
  console.log(`Node ${process.version}`);
  await check('comparison preserves ICO proportions and 100% pixel scale', async () => {
    const { createCanvas } = await import('../src/ui/canvas.mjs');
    const app = { source: { width: 960, height: 640 }, view: { centerX: 480, centerY: 320 } };
    const image = { width: 256, height: 256 }; let drawn;
    const actions = createCanvas({ app, els: {} }, { drawBackground() {}, drawImageFrame() {}, getDrawScale: () => 2 });
    actions.drawVariant({ canvas: { width: 1000, height: 800 }, bitmap: image, ctx: { drawImage: (...args) => { drawn = args; } } });
    assert.deepEqual(drawn, [image, 244, 144, 512, 512]);
  });
  const encodedCases = [];
  for (const file of pages) {
    const ctx = await context(file);
    await check(`${file}: GIF end code and dictionary width boundaries`, () => {
      for (const minimum of [2, 3, 4, 8]) {
        for (const length of [...Array.from({ length: 80 }, (_, i) => i + 1), 255, 256, 257, 511, 512, 513, 70000]) {
          let seed = 7654321;
          ctx.indices = Uint8Array.from({ length }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return (seed >>> 20) % (1 << minimum);
          });
          const bytes = vm.runInContext(`gifLzwEncode(indices, ${minimum})`, ctx);
          assert.deepEqual(decodeLzw(bytes, minimum), Array.from(ctx.indices), `minimum=${minimum} length=${length}`);
        }
      }
    });
    await check(`${file}: palette limits`, () => {
      ctx.input = pixels(32, 32, false).imageData.data;
      for (let limit = 1; limit <= 8; limit++) {
        ctx.limit = limit;
        const quant = vm.runInContext('quantizeUniform(input, limit, false)', ctx);
        assert.ok(quant.palette.length <= limit, `${quant.palette.length} colors for limit ${limit}`);
      }
    });
    await check(`${file}: PSNR examines every pixel`, () => {
      ctx.a = new Uint8ClampedArray(1800000 * 4);
      ctx.b = new Uint8ClampedArray(ctx.a.length);
      for (let p = 0; p < 1800000; p++) {
        ctx.a[p * 4 + 3] = ctx.b[p * 4 + 3] = 255;
        if (p % 2) ctx.b[p * 4] = 255;
      }
      assert.ok(Number.isFinite(vm.runInContext('computePsnr(a,b)', ctx)));
      assert.equal(vm.runInContext('computePsnr(a,a)', ctx), Infinity);
      assert.equal(vm.runInContext('computePsnr(a,new Uint8ClampedArray(4))', ctx), null);
    });
    await check(`${file}: a failed codec can be retried`, async () => {
      const result = await vm.runInContext(`(async () => {
        let attempts = 0;
        loadScript = async () => { attempts++; throw new Error('simulated offline'); };
        const counts=[];
        for (let n = 0; n < 2; n++) { const before=attempts; try { await loadOptionalCodec('upng'); } catch {} counts.push(attempts-before); }
        return counts;
      })()`, ctx);
      assert.ok(result.length===2 && result.every(count=>count>0), `requests per attempt: ${result}`);
    });
    for (const alpha of [false, true]) {
      for (const [width, height] of [[1,1], [4,4], [16,16], [64,64], [257,257]]) {
        ctx.fixture = pixels(width, height, alpha);
        vm.runInContext('app.source = fixture', ctx);
        for (const colors of [2, 3, 7, 256]) {
          for (const dither of [false, true]) {
            const e = vm.runInContext(`encodeGif(${colors}, ${dither}, app.source)`, ctx);
            encodedCases.push({ name: `${file}: GIF ${width}x${height} alpha=${alpha} colors=${colors} dither=${dither}`,
              format: 'GIF', limit: colors, data: Buffer.from(await e.blob.arrayBuffer()).toString('base64'),
              expected: Buffer.from(e.previewImageData.data).toString('base64') });
          }
        }
        for (const withAlpha of [false, true]) {
          const e = vm.runInContext(`encodeBmp(${withAlpha}, 'white', app.source)`, ctx);
          encodedCases.push({ name: `${file}: BMP${withAlpha ? 32 : 24} ${width}x${height} alpha=${alpha}`,
            format: 'BMP', data: Buffer.from(await e.blob.arrayBuffer()).toString('base64'),
            expected: Buffer.from(e.previewImageData.data).toString('base64') });
        }
      }
    }
  }
  const python = process.env.IMAGE_TEST_PYTHON || 'python';
  const result = spawnSync(python, [path.join(__dirname, 'verify_images.py')], {
    input: JSON.stringify(encodedCases), encoding: 'utf8', maxBuffer: 5 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) failed++;
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
