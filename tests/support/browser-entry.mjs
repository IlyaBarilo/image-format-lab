// Instrumentation for existing race/failure tests; never included in the public HTML.
import { createApplication } from '../../src/application.mjs';

const application = createApplication();
const { app, els, actions, config } = application;
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
