import { FORMAT_DEFS } from './config.mjs';

// Keep encoding/settings identifiers stable while grouping related choices in selectors.
export const isBmpFormat = format => ['bmp8','bmp24','bmp32'].includes(format);
export const isPngFormat = format => ['png','pngIndexed','pngUpng'].includes(format);
export const formatOptionValue = format => isBmpFormat(format) ? 'bmp' : isPngFormat(format) ? 'png' : format;
export const formatFromOption = (value, depth, pngMode = 'rgba') => value === 'bmp' ? (String(depth) === '8' ? 'bmp8' : String(depth) === '32' ? 'bmp32' : 'bmp24') : value === 'png' ? (pngMode === 'palette' ? 'pngIndexed' : pngMode === 'optimized' ? 'pngUpng' : 'png') : value;
export const FORMAT_OPTIONS = Object.entries(FORMAT_DEFS)
  .filter(([format]) => format !== 'bmp24' && format !== 'bmp32' && format !== 'pngIndexed' && format !== 'pngUpng')
  .map(([format, def]) => ({format, value: formatOptionValue(format), label: isBmpFormat(format) ? 'BMP' : def.label}));

// Reports describe the file format separately from its encoding mode.
export function reportFormatConfig(config) {
  const result={...config};
  const format=config.format;
  if(format==='pngIndexed') { result.format='png'; result.formatMode='palette'; }
  else if(format==='pngUpng') { result.format='png'; result.formatMode='optimized'; }
  else if(format==='png') result.formatMode='full-color';
  else if(isBmpFormat(format)) { result.format='bmp'; result.formatMode=format.slice(3)+'-bit'; result.bmpDepth=Number(format.slice(3)); }
  else if(format==='gifenc') { result.format='gif'; result.formatMode='gifenc'; }
  else if(format==='gif') result.formatMode='built-in';
  else if(format==='webpLossless') { result.format='webp'; result.formatMode='lossless'; }
  else if(format==='webp') result.formatMode='lossy';
  else if(format==='jxlLossless') { result.format='jxl'; result.formatMode='lossless'; }
  else if(format==='jxl') result.formatMode='lossy';
  else if(format==='jp2'||format==='j2k') result.formatMode=config.quality===100?'lossless':'lossy';
  return result;
}
