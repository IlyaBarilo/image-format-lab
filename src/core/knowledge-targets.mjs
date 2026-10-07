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

// Stable, deliberately limited navigation targets. A help URL never runs an operation.
export const HELP_OPERATIONS = Object.freeze({
  'crop-source': { title: 'Создать исходник из области', control: 'analysisScope', fallback: 'analysisType', analysis: true,
    prerequisite: 'Выберите обычную «Гистограмму»: в режиме размера и точного float-исходника список области скрыт.' },
  'view-layout': { title: 'Два или четыре окна', control: 'layout4' },
  'format-settings': { title: 'Настроить формат изображения', selector: '.cell:not(.hidden) .format-select', fallback: 'layout2' },
  'graph-settings': { title: 'Выбрать график и область анализа', control: 'analysisType', analysis: true },
  'analysis-line': { title: 'Задать линию профиля', control: 'analysisLineOpen', fallback: 'analysisType', analysis: true,
    prerequisite: 'Сначала выберите «Профиль по линии» или «Профиль ошибки» и откройте изображение.' },
  'export-graph': { title: 'Сохранить график PNG', control: 'analysisPNG', analysis: true,
    prerequisite: 'Дождитесь готовности графиков. Кнопка PNG сохраняет анализ, а не изображение из ячейки.' }
});

export function helpCodeFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const code = params.get('help');
  return params.getAll('help').length === 1 && Object.hasOwn(HELP_OPERATIONS, code) ? code : null;
}
