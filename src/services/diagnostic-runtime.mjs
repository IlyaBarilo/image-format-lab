import * as utils from '../core/utils.mjs';
import * as gif from '../core/gif.mjs';
import * as bmp from '../core/bmp.mjs';
import * as metrics from '../core/metrics.mjs';
import * as metadata from '../core/metadata.mjs';
import * as pixels from '../core/pixels.mjs';
import * as settings from '../core/settings.mjs';
import { createHeic } from './heic.mjs';
import { createModern } from './modern.mjs';
import { createTiff } from './tiff.mjs';
import { createJpeg2000 } from './jpeg2000.mjs';
import { createPng } from './png.mjs';
import { createDecode } from './decode.mjs';
import { createEncode } from './encode.mjs';
import { createCompute } from './compute.mjs';

// A separate composition root: never borrow the viewer's Worker or encoding queue.
export function createDiagnosticRuntime(deps) {
  const context = { app: {}, els: {} }, actions = { ...utils, ...gif, ...bmp, ...metrics, ...metadata, ...pixels, ...settings, showStatus() {} };
  const heic = createHeic(), modern = createModern(), tiff = createTiff(), jpeg2000 = createJpeg2000();
  const loaders = { heic: heic.loadHeicCodec, modern: modern.loadModernCodec, utif: tiff.loadTiffCodec, jpeg2000: jpeg2000.loadJpeg2000Codec };
  const codecs = {};
  const info = {};
  let disposed = false;
  actions.loadScript = (...args) => deps.loadScript(...args);
  actions.loadOptionalCodec = name => codecs[name] ??= Promise.resolve().then(() => loaders[name] ? loaders[name]() : deps.loadOptionalCodec(name)).then(codec => {
    if(codec.diagnosticInfo)info[name]=codec.diagnosticInfo;
    return Object.fromEntries(Object.entries(codec).map(([key, value]) => [key, typeof value === 'function' ? (...args) => {
      if (disposed) throw new Error('Операция отменена'); return value(...args);
    } : value]));
  });
  Object.assign(actions, createPng(context, actions));
  Object.assign(actions, createDecode(context, actions));
  Object.assign(actions, createEncode(context, actions));
  Object.assign(actions, createCompute(context, actions));
  for (const [name, fn] of Object.entries(actions)) if (typeof fn === 'function' && name !== 'disposeCompute') actions[name] = (...args) => {
    if (disposed) throw new Error('Операция отменена'); return fn(...args);
  };
  function dispose() {
    if (disposed) return; disposed = true;
    heic.disposeHeicCodec(); modern.disposeModernCodec(); tiff.disposeTiffCodec(); jpeg2000.disposeJpeg2000Codec();
    actions.disposeCompute();
  }
  return { actions, dispose, info };
}
