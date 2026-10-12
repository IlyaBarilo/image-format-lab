import { cropSourcePixels } from '../core/crop-source.mjs';
import { createReferenceSamplePixels, createTiff16SamplePixels, createTiffFloatSample, createCmykPrintSample } from '../core/reference-samples.mjs';
import { pixelBufferFromImageData } from '../core/pixels.mjs';
import { diagnosticHash, diagnosticPixelHash, diagnosticDataHash } from '../core/diagnostics.mjs';
import { buildComparisonSummary, summaryMatrix } from '../core/comparison-summary.mjs';

export const DIAGNOSTIC_LAB_CASES = Object.freeze([
  'photo-png', 'photo-bmp', 'photo-j85', 'photo-a85', 'photo-j30', 'photo-j60', 'photo-j90', 'photo-a73',
  'palette32', 'dither32', 'sample16', 'sample-float', 'errors', 'scopes', 'sample-alpha', 'print-tiff', 'print-jpeg', 'metric-worker'
]);

// Fixed processing conditions, independent of the selected file or student's variant.
export function diagnosticLabTasks({ getRuntime, photo, config, makeSource }) {
  let photoSource, photoPromise;
  const outputs = new Map();
  async function source() {
    if (photoSource) return photoSource;
    if (!photo) throw new Error('photo unsupported');
    photoPromise ??= (async () => {
      const decoded = await getRuntime().actions.decodeImageBlob(photo);
      try {
        const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(decoded.image, 0, 0);
        const pixels = pixelBufferFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        const cropped = cropSourcePixels(pixels, { unit: 'pixels', x: 896, y: 104, width: 640, height: 480 }).pixels;
        const result = makeSource(cropped);
        const blob = await getRuntime().actions.encodeExactPng(cropped, 8, { filter: 'paeth', level: 6 });
        const reopened = await getRuntime().actions.decodeVariantForPreview(blob, true);
        try { result.pixelBuffer = reopened.pixelBuffer; } finally { reopened.bitmap?.close?.(); }
        result.size = blob.size;
        return result;
      } finally { decoded.close?.(); }
    })().catch(error => { photoPromise = null; throw error; });
    return photoSource = await photoPromise;
  }
  async function convert(id, input, extra) {
    const actions = getRuntime().actions;
    const settings = { ...config, pngFilter: 'paeth', pngLevel: 6, jpegSubsampling: '420', jpegProgressive: false, avifSpeed: 6, ...extra };
    const encoded = await actions.encodeFromSource(settings, input);
    const decoded = await actions.decodeVariantForPreview(encoded.blob, encoded.exactPng);
    try {
      const metrics = await actions.measurePixels(encoded.sourcePixelBuffer, decoded.pixelBuffer, { allowUnknownColorSpace: true });
      const values = { b: encoded.blob.size, P: metrics.psnr, a: metrics.alpha };
      const result = { values, fileHash: await diagnosticHash(encoded.blob), pixelHash: await diagnosticPixelHash(decoded.pixelBuffer), inputHash: await diagnosticPixelHash(encoded.sourcePixelBuffer) };
      outputs.set(id, { pixels: decoded.pixelBuffer, values, settings });
      return result;
    } finally { decoded.bitmap?.close?.(); }
  }
  const tasks = {};
  for (const [id, format, quality] of [
    ['photo-png', 'png', 85], ['photo-bmp', 'bmp24', 85], ['photo-j85', 'jpeg', 85], ['photo-a85', 'avif', 85],
    ['photo-j30', 'jpeg', 30], ['photo-j60', 'jpeg', 60], ['photo-j90', 'jpeg', 90], ['photo-a73', 'avif', 73]
  ]) tasks[id] = async () => convert(id, await source(), { format, quality });
  for (const [id, dither] of [['palette32', false], ['dither32', true]]) tasks[id] = async () => {
    const input = makeSource(createReferenceSamplePixels('palette'));
    const result = await convert(id, input, { format: 'pngIndexed', gifColors: 32, gifDither: dither });
    const histogram = await getRuntime().actions.workerCompute('histogram', { pixelBuffer: outputs.get(id).pixels, matte: 'white', region: { unit: 'pixels', x: 64, y: 0, width: 256, height: 160 } });
    result.values.levels = histogram.channels.slice(0, 3).map(channel => channel.reduce((sum, count) => sum + +(count > 0), 0)).join(',');
    return result;
  };
  tasks.sample16 = async () => {
    const input = makeSource(createTiff16SamplePixels());
    const result = await convert('sample16', input, { format: 'png', pngDepth: '16' });
    const histogram = await getRuntime().actions.workerCompute('histogram', { pixelBuffer: outputs.get('sample16').pixels, matte: 'white' });
    result.values.top = histogram.scale.max;
    result.values.hHist16 = await diagnosticDataHash(histogram);
    return result;
  };
  tasks['sample-float'] = async () => {
    const sample = createTiffFloatSample();
    const decoded = await getRuntime().actions.decodeSourceFile(new File([sample.bytes], 'float.tif', { type: 'image/tiff' }));
    try {
      const pixels = decoded.nativePixelBuffer ?? decoded.pixelBuffer;
      const histogram = await getRuntime().actions.workerCompute('histogram', { pixelBuffer: pixels, matte: 'white', options: { range: [0, 1], bins: 256, floatPeak: 1, rawRgb: true } });
      return { values: { low: histogram.underflow[0], high: histogram.overflow[0] }, pixelHash: await diagnosticPixelHash(pixels) };
    } finally { decoded.bitmap?.close?.(); }
  };
  tasks.errors = async () => {
    const input = await source(), result = outputs.get('photo-j30');
    if (!result) throw new Error('JPEG result missing');
    const actions = getRuntime().actions, payload = { pixelBuffer: result.pixels, reference: input.pixelBuffer, matte: 'white' };
    const histogram = await actions.workerCompute('errorHistogram', payload);
    const difference = await actions.workerCompute('difference', payload);
    const ssim = await actions.workerCompute('ssim', payload);
    const profile = await actions.workerCompute('errorProfile', { ...payload, line: { x0: 0, y0: 500, x1: 1000, y1: 500 } });
    return { values: { MAE: histogram.metrics.maeRGB, RMSE: histogram.metrics.rmseRGB, mean: difference.means[0], peak: difference.maxima[0], n: difference.changed[0], line: profile.means[0], SSIM: ssim.score,
      hErrors: await diagnosticDataHash(histogram), hMap: await diagnosticDataHash(difference), hSSIM: await diagnosticDataHash(ssim), hErrorLine: await diagnosticDataHash(profile) } };
  };
  tasks.scopes = async () => {
    const input = await source(), pixels = outputs.get('photo-j30')?.pixels;
    if (!pixels) throw new Error('JPEG result missing');
    const actions = getRuntime().actions;
    const h = await actions.workerCompute('histogram', { pixelBuffer: pixels, matte: 'white' });
    const signal = await actions.workerCompute('signalHistogram', { pixelBuffer: pixels, matte: 'white' });
    const wave = await actions.workerCompute('waveform', { pixelBuffer: pixels, matte: 'white', region: { unit: 'pixels', x: 0, y: 208, width: 640, height: 64 } });
    const vector = await actions.workerCompute('vectorscope', { pixelBuffer: pixels, matte: 'white' });
    const cie = await actions.workerCompute('cieXy', { pixelBuffer: pixels, matte: 'white' });
    const line = await actions.workerCompute('profile', { pixelBuffer: pixels, matte: 'white', line: { x0: 0, y0: 500, x1: 1000, y1: 500 } });
    return { values: { pixels: h.pixelCount, strip: wave.pixelCount, Y: signal.means[0], waveY: wave.means[3],
      hRGB: await diagnosticDataHash(h), hYC: await diagnosticDataHash(signal), hWave: await diagnosticDataHash(wave), hVector: await diagnosticDataHash(vector), hCIE: await diagnosticDataHash(cie), hLine: await diagnosticDataHash(line) }, inputHash: await diagnosticPixelHash(input.pixelBuffer) };
  };
  tasks['sample-alpha'] = async () => {
    const input = makeSource(createReferenceSamplePixels('alpha'));
    const result = await convert('sample-alpha', input, { format: 'jpeg', quality: 90 });
    const actions = getRuntime().actions, pixels = outputs.get('sample-alpha').pixels;
    const histogram = await actions.workerCompute('histogram', { pixelBuffer: input.pixelBuffer, matte: 'white' });
    const difference = await actions.workerCompute('difference', { pixelBuffer: pixels, reference: input.pixelBuffer, matte: 'white' });
    const boundaries = await actions.workerCompute('boundaryMap', { pixelBuffer: input.pixelBuffer, matte: 'white' });
    const profile = await actions.workerCompute('profile', { pixelBuffer: input.pixelBuffer, matte: 'white', line: { x0: 0, y0: 375, x1: 1000, y1: 375 } });
    result.values = { a: result.values.a, low: histogram.channels[3][0], high: histogram.channels[3][255], mean: difference.means[1], n: difference.changed[1], line: profile.means[3], edge: boundaries.counts[1].any,
      hAlpha: await diagnosticDataHash([histogram, difference, boundaries, profile]) };
    return result;
  };
  for (const [id, format] of [['print-tiff', 'tiff'], ['print-jpeg', 'jpeg']]) tasks[id] = async () => {
    const cmyk = createCmykPrintSample(), codec = await getRuntime().actions.loadOptionalCodec('utif');
    const blob = await codec.encodeCmyk(cmyk, format, { ...config, quality: 90, tiffCompression: 'deflate', tiffLevel: 6, tiffPredictor: true });
    const decoded = await (format === 'tiff' ? codec.decode(blob) : codec.decodeCmykJpeg(blob));
    if (!decoded.cmyk) throw new Error('CMYK missing');
    const statistics = [];
    for (const threshold of [280, 300, 320]) statistics.push(await getRuntime().actions.workerCompute('cmyk', { cmyk: decoded.cmyk, reference: cmyk, threshold }));
    return { values: { b: blob.size, TAC: statistics[0].tacMaximum, over: statistics.map(s => s.tacOverPixels).join(','), lostK: statistics[0].kOnly.lostPixels,
      MAE: statistics[0].difference.meanAbsolute.map(value => Number(value.toFixed(5))).join(','), hCMYK: await diagnosticDataHash(statistics) }, fileHash: await diagnosticHash(blob), pixelHash: await diagnosticHash(decoded.cmyk.data) };
  };
  tasks['metric-worker'] = async () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255]);
    const a = pixelBufferFromImageData(new ImageData(data, 2, 1)), b = { ...a, data: data.slice() }; b.data[0] = 3;
    const actions = getRuntime().actions, options = { allowUnknownColorSpace: true };
    const measured = await actions.measurePixels(a, b, options);
    const worker = await actions.workerCompute('metrics', actions.prepareMetricInputs(a, b, options));
    const summary = buildComparisonSummary({ source: { width: 2, height: 1, bitDepth: 8 }, variants: [{ cell: 1, status: 'ready', config: { format: 'jpeg', quality: 85 }, metrics: { bytes: 100, width: 2, height: 1, bitDepth: 8, psnrRGB: measured.psnr, alphaErrorPercent: measured.alpha } }] });
    const matrix = summaryMatrix(summary);
    return { values: { P: measured.psnr, delta: Math.abs(worker.psnr - measured.psnr), bpp: summary.rows[0].bpp, display: matrix[1][11] } };
  };
  return tasks;
}
