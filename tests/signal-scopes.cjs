// Computed RGB8 signal scopes: shared BT.709 math, area, matte and comparison data.
const assert = require('node:assert/strict');

(async () => {
  const { signalLevels, computeSignalHistogram } = await import('../src/core/signal-scopes.mjs');
  const { computeWaveform } = await import('../src/core/waveform.mjs');
  const { analysisDelta } = await import('../src/core/analysis-delta.mjs');
  const { analysisMaximum, analysisJSON } = await import('../src/core/analysis-output.mjs');
  const image = pixels => ({ width: pixels.length, height: 1, data: Uint8ClampedArray.from(pixels.flat()) });
  const black = image([[0, 0, 0, 255]]), white = image([[255, 255, 255, 255]]);
  const red = image([[255, 0, 0, 255]]), transparent = image([[255, 0, 0, 0]]);
  assert.deepEqual(signalLevels(0, 0, 0), [0, 128, 128]);
  assert.deepEqual(signalLevels(255, 255, 255), [255, 128, 128]);
  assert.equal(signalLevels(255, 0, 0)[0], 54);
  assert.equal(signalLevels(255, 0, 0)[2], 255);
  assert.equal(signalLevels(0, 0, 255)[1], 255);
  for (const [source, matte, expected] of [[transparent, 'white', 255], [transparent, 'black', 0]]) {
    const hist = computeSignalHistogram(source, matte), wave = computeWaveform(source, matte);
    assert.equal(hist.channels[0][expected], 1);
    assert.equal(hist.channels[1][128], 1);
    assert.equal(hist.channels[2][128], 1);
    assert.equal(wave.channels[3][expected], 1);
    assert.equal(wave.channels[4][128], 1);
    assert.equal(wave.channels[5][128], 1);
  }
  const mixed = image([[0,0,0,255],[255,0,0,255],[255,255,255,255]]);
  const area = { unit:'pixels', x: 1, y: 0, width: 1, height: 1 };
  const histogram = computeSignalHistogram(mixed, 'white', area);
  assert.equal(histogram.pixelCount, 1);
  assert.equal(histogram.channels[0][54], 1);
  assert.equal(histogram.channels[2][255], 1);
  assert.deepEqual(histogram.channels.map(c => c.reduce((a,b) => a+b,0)), [1,1,1]);
  const wave = computeWaveform(mixed, 'white', area);
  for (const [i,v] of signalLevels(255,0,0).entries()) assert.equal(wave.channels[i+3][v], 1);
  assert.equal(wave.columns, 1);
  assert.equal(analysisMaximum('signalHistogram', [{data: histogram}]), 100);
  assert.equal(analysisMaximum('ycbcrParade', [{data: wave}]), 1);
  assert.equal(analysisMaximum('rgbWaveform', [{data: wave}]), 1);
  const pair = (a,b) => [{cell:1,data:a},{cell:2,data:b}];
  const histDelta = analysisDelta(pair(computeSignalHistogram(black), computeSignalHistogram(white)), {type:'signalHistogram',channel:'rgb'});
  assert.equal(histDelta.maximum, 100);
  assert.equal(histDelta.channels.length, 3);
  assert.equal(histDelta.channels[0].values[0], -100);
  assert.equal(histDelta.channels[0].values[255], 100);
  for (const type of ['rgbWaveform','ycbcrParade']) {
    const delta = analysisDelta(pair(computeWaveform(black),computeWaveform(red)), {type});
    assert.equal(delta.channels.length, 3);
    assert.equal(delta.unit,'percentage-points');
    assert.equal(delta.alignment,'relative-column-area');
    assert.ok(JSON.parse(analysisJSON({delta})).delta.channels[0].values.length === 256);
  }
  assert.throws(() => computeSignalHistogram(red,'invalid'));
  console.log('PASS BT.709 RGB8 signal levels, alpha/matte, ROI, histogram, spatial counts and signed comparison');
})().catch(error => { console.error(error); process.exitCode = 1; });
