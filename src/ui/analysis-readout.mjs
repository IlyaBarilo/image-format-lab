// Read existing analysis results without retaining source rasters.
import { histogramSummary } from '../core/histogram-view.mjs';
import { errorHistogramSummary } from '../core/error-histogram.mjs';
import { profileMeanSummary } from './profile-summary.mjs';
const fmt = (n, digits = 3) => n === Infinity ? '∞' : n.toLocaleString('ru-RU', {maximumFractionDigits:digits});
const delta = n => n && Math.abs(n) < .001 ? n.toExponential(2) : fmt(n);

export function differenceSummary(data, index = 0) {
  const name = index ? 'α' : 'RGB';
  return `Изменено ${name}: ${fmt(data.changed[index])} пикселей (${fmt(data.changed[index] / data.pixelCount * 100)}%). Средняя разность ${name}: ${delta(data.means[index])} уровня из 255; максимум ${delta(data.maxima[index])}. Усиление меняет только вид карты.`;
}

export function analysisReadout(snapshot) {
  if (!snapshot?.source) return '';
  const s = snapshot.settings;
  const scope = s.scope === 'viewport' ? 'Видимая часть каждой ячейки' : s.scope === 'full' ? 'Весь кадр' : 'Заданная область';
  const items = ['overlay','delta'].includes(s.display)
    ? s.pair.map(cell => snapshot.items.find(i => i.cell === cell)).filter(Boolean) : snapshot.items;
  return [scope + '. Данные относятся к текущему анализу, а не к размеру полного файла.',
    ...items.map(item => {
      const d = item.data;
      if (!d) return `${item.label}: ${item.message || 'Результат недоступен.'}`;
      const b = d.bounds, profile = ['profile','errorProfile'].includes(s.type), count = profile ? d.sampleCount : d.pixelCount ?? d.sampleCount;
      let text = `${item.label}: ${b ? `область X=${b.x}, Y=${b.y}, ${b.width}×${b.height} px; ` : ''}${count === undefined ? '' : fmt(count) + (profile ? ' отсчётов линии. ' : ' пикселей области. ')}`;
      if (s.type === 'cmyk') {
        text += 'Среднее количество краски по всем пикселям области: ' + d.means.map((n,i) => `${'CMYK'[i]} ${fmt(n)}%`).join(' · ') + '. Это не средняя ошибка и не среднее только K-only. ';
        text += `Выше TAC ${d.threshold}%: ${fmt(d.tacOverPixels)} пикселей (${fmt(d.tacOverPercent)}%); максимум ${fmt(d.tacMaximum)}%. Только K: сохранено ${fmt(d.kOnly.retainedPixels)} из ${fmt(d.kOnly.sourcePixels)}, утрачено ${fmt(d.kOnly.lostPixels)}.`;
        if (d.difference) text += ' Среднее абсолютное отклонение K: ' + delta(d.difference.meanAbsolute[3]) + '% полного диапазона.';
      } else if (s.type === 'difference') text += differenceSummary(d, s.differenceChannel === 'alpha' ? 1 : 0);
      else if (['histogram','floatSource'].includes(s.type)) {
        text += histogramSummary(d, s.channel);
        if (d.means) {
          const indices = {rgb:[0,1,2],r:[0],g:[1],b:[2],alpha:[3]}[s.channel] || [0,1,2];
          text += ' Средние: ' + indices.map(i => `${['R','G','B','α'][i]} ${fmt(d.means[i])}`).join(' · ') + '. Это значения, а проценты гистограммы — доля пикселей.';
        }
      } else if (s.type === 'profile') {
        const p = d.points;
        text += `Линия A(${p.x0}, ${p.y0}) → B(${p.x1}, ${p.y1}). ` + profileMeanSummary(d, s.profileChannel) + ' Среднее всей линии не равно значению выбранной позиции.';
      } else if (s.type === 'boundaryMap') {
        const c = d.counts[s.boundaryChannel === 'alpha' ? 1 : 0];
        text += `Уровень 0: ${fmt(c.low)} пикселей (${fmt(c.low / d.pixelCount * 100)}%); максимум ${d.scaleMax}: ${fmt(c.high)} (${fmt(c.high / d.pixelCount * 100)}%). Граничный код сам по себе не доказывает клиппинг.`;
      } else if (s.type === 'errorHistogram') text += errorHistogramSummary(d);
      else if (s.type === 'ssim') text += `SSIM ${fmt(d.score, 4)} — безразмерный показатель, не процент качества.`;
      else if (s.type === 'deltaE') text += `Средняя ΔE00 ${fmt(d.mean)}, максимум ${fmt(d.maximum)}. ${d.exact ? 'Все пиксели области.' : 'Показатели по выборке.'}`;
      else text += snapshot.method || '';
      return text;
    })].join('\n\n');
}

export function createAnalysisReadout(root, button, content) {
  if (!root || !button || !content) return {update() {}, attach() {}};
  let pinned = false, attached = false, timer;
  const close = () => { clearTimeout(timer); pinned = false; content.hidden = true; button.setAttribute('aria-expanded','false'); };
  const open = () => { clearTimeout(timer); if (button.disabled) return; content.hidden = false; button.setAttribute('aria-expanded','true'); };
  return {
    update(snapshot) {
      const text = analysisReadout(snapshot);
      content.textContent = text; button.disabled = !text;
      if (!text) close();
    },
    attach() {
      if (attached) return; attached = true;
      root.addEventListener('pointerenter', open);
      root.addEventListener('pointerleave', () => { timer = setTimeout(() => { if (!pinned && !root.contains(document.activeElement)) close(); }, 120); });
      root.addEventListener('focusin', open);
      root.addEventListener('focusout', e => { if (!root.contains(e.relatedTarget)) close(); });
      button.addEventListener('click', () => { if (pinned) close(); else { pinned = true; open(); } });
      root.addEventListener('keydown', e => { if (e.key === 'Escape' && !content.hidden) { e.preventDefault(); e.stopPropagation(); button.focus(); close(); } });
      document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); });
    }
  };
}
