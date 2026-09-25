import { encodeBmp } from '../core/bmp.mjs';
import { encodeGif } from '../core/gif.mjs';
import { computePixelMetrics } from '../core/metrics.mjs';
import { computeHistogram } from '../core/histogram.mjs';
import { computeErrorHistogram } from '../core/error-histogram.mjs';
import { computeWaveform } from '../core/waveform.mjs';
import { computeSignalHistogram } from '../core/signal-scopes.mjs';
import { computeDifference } from '../core/difference.mjs';
import { computeVectorscope } from '../core/vectorscope.mjs';
import { computeLineProfile } from '../core/line-profile.mjs';
import { computeErrorProfile } from '../core/error-profile.mjs';
import { computeSSIM } from '../core/ssim.mjs';

self.onmessage = event => {
  try {
    const { kind, payload } = event.data;
    let result;
    if (kind === 'metrics') result = computePixelMetrics(payload.a, payload.b, payload.options);
    else if (kind === 'histogram') result = computeHistogram(payload.pixelBuffer || payload.imageData, payload.matte, payload.region, payload.options);
    else if (kind === 'errorHistogram') result = computeErrorHistogram(payload.pixelBuffer, payload.reference, payload.matte, payload.region);
    else if (kind === 'waveform') result = computeWaveform(payload.imageData, payload.matte, payload.region);
    else if (kind === 'signalHistogram') result = computeSignalHistogram(payload.imageData, payload.matte, payload.region);
    else if (kind === 'difference') result = computeDifference(payload.imageData, payload.reference, payload.matte, payload.region);
    else if (kind === 'vectorscope') result = computeVectorscope(payload.imageData, payload.matte, payload.region);
    else if (kind === 'profile') result = computeLineProfile(payload.imageData, payload.matte, payload.region, payload.line);
    else if (kind === 'errorProfile') result = computeErrorProfile(payload.pixelBuffer, payload.reference, payload.matte, payload.region, payload.line);
    else if (kind === 'ssim') result = computeSSIM(payload.pixelBuffer, payload.reference, payload.matte, payload.region);
    else {
      const { config, source } = payload;
      const encoded = kind === 'gif' ? encodeGif(config.gifColors, config.gifDither, source, false)
        : encodeBmp(kind === 'bmp32', config.matte, source, false);
      result = { blob: encoded.blob };
    }
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
