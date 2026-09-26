import { OPTIONAL_CODECS } from "./../core/config.mjs";
import { embeddedCodecSource, embeddedCodecsNeedInflater } from './embedded-codecs.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createCodecs({els, app}, deps) {
  let activationPromise = null;
  const codecErrors = {};

  function loadAdditionalCodecs() {
    if (activationPromise) return activationPromise;
    activationPromise = Promise.allSettled(Object.keys(OPTIONAL_CODECS)
      .map(name => Promise.resolve().then(() => deps.loadOptionalCodec(name))))
      .finally(() => {
        activationPromise = null;
        deps.updateCodecStatus();
        deps.updateFormatOptions();
      });
    deps.updateCodecStatus();
    return activationPromise;
  }
  
  async function loadOptionalCodec(name) {
    if (app.codecs[name]) return app.codecs[name];
    if (app.codecPromises[name]) return app.codecPromises[name];
    const def = OPTIONAL_CODECS[name];
    if (!def) throw new Error("Неизвестный кодек: " + name);
    delete codecErrors[name];
    const attempt = app.codecAttempts[name] || 0;
    app.codecAttempts[name] = attempt + 1;
    const promise = (async () => {
      if (def.kind === 'worker') {
        // The small pako script stays uncompressed and already serves PNG/TIFF.
        // loadScript coalesces this with PNG and other worker startup requests.
        if (embeddedCodecsNeedInflater()) await deps.loadScript('vendor/pako-2.1.0.min.js');
        const loaded = await (name === 'utif' ? deps.loadTiffCodec() : name === 'modern' ? deps.loadModernCodec() :
          name === 'jpeg2000' ? deps.loadJpeg2000Codec() : deps.loadHeicCodec());
        app.codecs[name] = loaded;
        return loaded;
      }
      let lastError = null;
      for (const dep of def.deps || []) await deps.loadScript(dep);
      for (const url of def.urls) {
        try {
          const loaded = def.ready(await deps.loadScript(url));
          if (loaded) {
            app.codecs[name] = loaded;
            return loaded;
          }
        } catch (error) { lastError = error; }
      }
      throw new Error(def.label + " не загружен" + (lastError ? ": " + lastError.message : ""));
    })();
    app.codecPromises[name] = promise;
    deps.updateCodecStatus();
    try { return await promise; }
    catch (error) { codecErrors[name] = error.message || String(error); throw error; }
    finally {
      if (app.codecPromises[name] === promise) delete app.codecPromises[name];
      deps.updateCodecStatus();
      deps.updateFormatOptions();
    }
  }
  
  
  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Превышено время загрузки кодека")), timeoutMs);
      Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }
  
  function loadScript(url) {
    if (app.scriptPromises.has(url)) return app.scriptPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let objectUrl = null, finished = false;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
        script.remove();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (error) reject(error);
        else resolve(window);
      };
      const onLoad = () => finish(null);
      const onError = () => finish(new Error("Не удалось загрузить " + url));
      const timer = setTimeout(() => finish(new Error("Превышено время загрузки " + url)), 15000);
      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);
      try {
        objectUrl = URL.createObjectURL(new Blob([embeddedCodecSource(url)], { type: 'text/javascript' }));
        script.src = objectUrl;
        script.async = true;
        document.head.append(script);
      } catch (error) { finish(error); }
    });
    app.scriptPromises.set(url, promise);
    promise.catch(() => { if (app.scriptPromises.get(url) === promise) app.scriptPromises.delete(url); });
    return promise;
  }
  
  function updateCodecStatus() {
    const loaded = Object.keys(app.codecs).length;
    const total = Object.keys(OPTIONAL_CODECS).length;
    const pending = Boolean(activationPromise) || Object.keys(app.codecPromises).length > 0;
    const failed = Object.keys(codecErrors).some(name => !app.codecs[name]);
    els.codecStatus.textContent = failed && !pending ? "Ошибка запуска кодеков" : "";
    els.codecStatus.dataset.state = pending ? "loading" : failed ? "error" : loaded === total ? "ready" : "idle";
    els.codecNotice.hidden = pending || !failed;
    els.codecStatus.title = Object.entries(OPTIONAL_CODECS)
      .map(([key, def]) => `${def.label}: ${app.codecs[key] ? "готов" : codecErrors[key] ? codecErrors[key] : "запускается"}`)
      .join("\n");
    els.retryCodecs.hidden = !failed || pending;
    els.retryCodecs.disabled = pending;
  }

  return { loadAdditionalCodecs, loadOptionalCodec, withTimeout, loadScript, updateCodecStatus };
}
