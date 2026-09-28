// One mapping for the builder and the viewer. IDs refer to knowledge pages.
export const FORMAT_KNOWLEDGE = Object.freeze({
  original: 'concepts/compression', jpeg: 'formats/jpeg', png: 'formats/png',
  pngIndexed: 'formats/png', pngUpng: 'formats/png', webp: 'formats/webp',
  webpLossless: 'formats/webp', avif: 'formats/avif', heic: 'formats/heic',
  jxl: 'formats/jpeg-xl', jxlLossless: 'formats/jpeg-xl', jp2: 'formats/jpeg-2000',
  j2k: 'formats/jpeg-2000', tiff: 'formats/tiff', gif: 'formats/gif',
  gifenc: 'formats/gif', bmp8: 'formats/bmp', bmp24: 'formats/bmp',
  bmp32: 'formats/bmp', bmp: 'formats/bmp', ico: 'formats/ico'
});

// Every entry in the analysis selector resolves to the section for that mode.
export const ANALYSIS_KNOWLEDGE = Object.freeze({
  histogram: 'analysis/histograms#rgb',
  signalHistogram: 'analysis/histograms#signal',
  floatSource: 'analysis/histograms#precise',
  cmyk: 'analysis/color#cmyk',
  errorHistogram: 'analysis/histograms#error',
  waveform: 'analysis/spatial#waveform',
  rgbWaveform: 'analysis/spatial#waveform',
  ycbcrWaveform: 'analysis/spatial#waveform',
  parade: 'analysis/spatial#parade',
  ycbcrParade: 'analysis/spatial#parade',
  profile: 'analysis/spatial#profile',
  errorProfile: 'analysis/spatial#error-profile',
  vectorscope: 'analysis/color#vectorscope',
  cieXy: 'analysis/color#cie-xy',
  deltaE: 'analysis/color#delta-e',
  difference: 'analysis/differences#difference',
  boundaryMap: 'analysis/differences#boundary',
  ssim: 'analysis/differences#ssim',
  tradeoff: 'analysis/tradeoff#graph'
});
