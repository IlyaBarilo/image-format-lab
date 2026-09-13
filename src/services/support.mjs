

// Dependencies are bound by application.mjs after all components are constructed.
export function createSupport({app}, deps) {
  function detectEncoderSupport() {
    app.support.set("image/png", deps.canDataUrlEncode("image/png"));
    app.support.set("image/jpeg", deps.canDataUrlEncode("image/jpeg"));
    app.support.set("image/webp", deps.canDataUrlEncode("image/webp"));
    deps.updateFormatOptions();
    deps.drawAll();
  

  }
  
  function canDataUrlEncode(type) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL(type, 0.8).startsWith(`data:${type}`);
    } catch (error) {
      return false;
    }
  }
  
  function canWorkerEncode(type, timeoutMs) {
    if (!("Worker" in window) || !("OffscreenCanvas" in window)) {
      return Promise.resolve(false);
    }
  
    const workerCode = `
      self.onmessage = async (event) => {
        try {
          const canvas = new OffscreenCanvas(1, 1);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ff0000";
          ctx.fillRect(0, 0, 1, 1);
          const blob = await canvas.convertToBlob({ type: event.data.type, quality: 0.8 });
          self.postMessage({ ok: Boolean(blob && blob.type === event.data.type) });
        } catch (error) {
          self.postMessage({ ok: false });
        }
      };
    `;
  
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
      const worker = new Worker(url);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        finish(Boolean(event.data && event.data.ok));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      worker.postMessage({ type });
    });
  }

  return { detectEncoderSupport, canDataUrlEncode, canWorkerEncode };
}
