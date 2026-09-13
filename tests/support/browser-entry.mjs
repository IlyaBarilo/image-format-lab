// Instrumentation for existing race/failure tests; never included in the public HTML.
import { createApplication } from '../../src/application.mjs';

const application = createApplication();
const { app, els, actions, config } = application;
// Hold scheduled work while assertions inspect invalidated results, then let
// the real automatic timer finish. This gate exists only in test instrumentation.
const renderVariant = actions.renderVariant;
let renderingGate = null, releaseRendering = null;
actions.renderVariant = async (...args) => {
  if (renderingGate) await renderingGate;
  return renderVariant(...args);
};
globalThis.holdComparisonRendering = () => {
  if (renderingGate) throw new Error('Comparison rendering is already held');
  renderingGate = new Promise(resolve => { releaseRendering = resolve; });
};
globalThis.resumeComparisonRendering = () => {
  releaseRendering?.();
  renderingGate = releaseRendering = null;
};
const sourceParameter = { encodeFromSource: 1, encodeOne: 1, prepareCanvasForFormat: 2, encodePngUpng: 0, encodeGifenc: 1, encodeGif: 2, encodeBmp: 2 };
Object.assign(globalThis, { app, els });
for (const [name, value] of Object.entries(config)) Object.defineProperty(globalThis, name, { configurable: true, get: () => value });
for (const name of Object.keys(actions)) Object.defineProperty(globalThis, name, {
  configurable: true,
  get() {
    const fn = actions[name];
    if (!Object.hasOwn(sourceParameter, name)) return fn;
    return (...args) => { args[sourceParameter[name]] ??= app.source; return fn(...args); };
  },
  set(value) { actions[name] = value; }
});
actions.init();
