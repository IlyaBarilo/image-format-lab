import { normalizeTiffOptions } from '../core/raster-codecs.mjs';

export function createFormatSettings() {
  let change = null, attached = false;
  const get = id => document.getElementById(id);
  function sync() {
    get('tiffLevelField').hidden = get('tiffCompression').value !== 'deflate';
    get('tiffPredictorField').hidden = get('tiffCompression').value === 'none';
    get('tiffLevelValue').textContent = get('tiffLevel').value;
  }
  function openTiffSettings(config, onChange) {
    const dialog = get('tiffSettingsDialog');
    if (dialog.open) return;
    const options = normalizeTiffOptions(config);
    get('tiffCompression').value = options.tiffCompression;
    get('tiffLevel').value = String(options.tiffLevel);
    get('tiffPredictor').checked = options.tiffPredictor;
    change = onChange;
    if (!attached) {
      attached = true;
      dialog.addEventListener('input', () => {
        sync();
        change?.(normalizeTiffOptions({tiffCompression:get('tiffCompression').value,
          tiffLevel:Number(get('tiffLevel').value), tiffPredictor:get('tiffPredictor').checked}));
      });
      dialog.addEventListener('close', () => { change = null; });
    }
    sync();
    dialog.showModal();
  }
  return { openTiffSettings };
}
