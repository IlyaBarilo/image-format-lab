// Node-only tests of the real preview controller; no browser or layout engine.
const assert = require('node:assert/strict');

(async () => {
  const { createCanvas } = await import('../src/ui/canvas.mjs');
  for (const dpr of [1, 2]) {
    globalThis.window = { devicePixelRatio: dpr };
    const readout = { textContent: '' };
    globalThis.document = { getElementById: () => readout };
    let rect = { width: 600, height: 400 }, draws = 0, resizing = false, updates = 0;
    const canvas = {
      width: 1, height: 1,
      getBoundingClientRect: () => rect,
      parentElement: { getBoundingClientRect: () => rect }
    };
    const app = {
      source: { width: 1200, height: 800 },
      variants: [{ canvas, cell: { classList: { contains: () => false } } }],
      view: { absoluteScale: null, zoom: 1, centerX: 630, centerY: 420 }
    };
    const deps = { clamp: (n, a, b) => Math.min(b, Math.max(a, n)), updateAnalysisViewport(){updates++;}, isAnalysisResizing:()=>resizing };
    const controller = createCanvas({ app, els: {} }, deps);
    Object.assign(deps, controller, { drawVariant: () => draws++ });
    controller.drawAll();
    assert.equal(canvas.width, 600 * dpr);
    assert.equal(canvas.height, 400 * dpr);
    assert.equal(controller.comparisonScale(), 0.47);

    const buffers=[canvas.width,canvas.height],drawsBeforeResize=draws,updatesBeforeResize=updates;
    resizing=true;rect={width:600,height:250};
    // Match the observer's independent resize and draw calls, including repeated notifications.
    for(let i=0;i<3;i++){controller.resizeCanvases();controller.drawAll();}
    assert.deepEqual([canvas.width,canvas.height],buffers);assert.equal(draws,drawsBeforeResize);assert.equal(updates,updatesBeforeResize);
    resizing=false;controller.drawAll();assert.equal(canvas.height,250*dpr);assert.equal(updates,updatesBeforeResize+1);

    const view = { ...app.view };
    rect = { width: 600, height: 200 };
    controller.drawAll();
    assert.equal(controller.comparisonScale(), 0.235, 'fit follows the shorter viewport');
    assert.deepEqual(app.view, view, 'resizing must not reset pan or zoom');
    controller.setComparisonScale(1);
    assert.equal(controller.getDrawScale(canvas) / dpr, 1, '100% is one CSS px per source px');

    const drawsBeforeHide = draws;
    rect = { width: 0, height: 0 };
    controller.drawAll();
    assert.deepEqual([canvas.width, canvas.height], [600 * dpr, 200 * dpr]);
    assert.equal(draws, drawsBeforeHide, 'hidden previews are not redrawn');
    assert.equal(readout.textContent, '100%');
    controller.setComparisonScale(0.5);
    assert.equal(controller.comparisonScale(), 0.5, 'zoom controls still work while hidden');
    assert.equal(readout.textContent, '50%');

    rect = { width: 600, height: 500 };
    controller.drawAll();
    assert.equal(canvas.height, 500 * dpr);
    assert.equal(controller.getDrawScale(canvas) / dpr, 0.5);
    assert.equal(app.view.centerX, view.centerX);
    assert.equal(app.view.centerY, view.centerY);
    controller.resetView();
    controller.drawAll();
    const fit = controller.comparisonScale();
    rect = { width: 0, height: 0 };
    controller.drawAll();
    assert.equal(controller.comparisonScale(), fit, 'hidden fit uses the last viewport');
    app.source = { width: 2400, height: 1600 };
    assert.equal(controller.comparisonScale(), fit / 2, 'a new source uses its own dimensions');
    app.source = null;
    controller.drawAll();
    assert.equal(readout.textContent, '—');
    console.log(`PASS preview resize, hidden buffers, zoom/fit restoration and source change at DPR=${dpr}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
