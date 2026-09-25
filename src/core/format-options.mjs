import { FORMAT_DEFS } from './config.mjs';

// Keep encoding/settings identifiers stable while grouping BMP in format selectors.
export const isBmpFormat = format => ['bmp8','bmp24','bmp32'].includes(format);
export const formatOptionValue = format => isBmpFormat(format) ? 'bmp' : format;
export const formatFromOption = (value, depth) => value === 'bmp' ? (String(depth) === '8' ? 'bmp8' : String(depth) === '32' ? 'bmp32' : 'bmp24') : value;
export const FORMAT_OPTIONS = Object.entries(FORMAT_DEFS)
  .filter(([format]) => format !== 'bmp24' && format !== 'bmp32')
  .map(([format, def]) => ({format, value: formatOptionValue(format), label: isBmpFormat(format) ? 'BMP' : def.label}));
