// Original explanatory diagrams for the offline help. No external images or SVG markup are loaded.
const NS = 'http://www.w3.org/2000/svg';

function node(tag, attributes = {}, label = '') {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (label) element.textContent = label;
  return element;
}

function label(svg, x, y, value, options = {}) {
  svg.append(node('text', { x, y, fill: '#ecf4fb', 'font-size': 13, 'font-family': 'system-ui, sans-serif', ...options }, value));
}

function frame(svg, x, y, width, height, fill = '#22384a') {
  svg.append(node('rect', { x, y, width, height, rx: 5, fill, stroke: '#728da0', 'stroke-width': 1 }));
}

function chroma(svg) {
  for (const [index, mode, samples] of [
    [0, '4:4:4', [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]]],
    [1, '4:2:2', [[0, 0], [2, 0], [0, 1], [2, 1]]],
    [2, '4:2:0', [[0, 0], [2, 0]]]
  ]) {
    const x = 16 + index * 202;
    label(svg, x, 27, mode, { 'font-weight': 700 });
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      svg.append(node('rect', { x: x + col * 42, y: 43 + row * 42, width: 40, height: 40,
        fill: '#35566a', stroke: '#7a9aaa', 'stroke-width': 1 }));
      svg.append(node('circle', { cx: x + col * 42 + 20, cy: 63 + row * 42, r: 3, fill: '#eff7fb' }));
    }
    for (const [col, row] of samples) svg.append(node('circle', {
      cx: x + col * 42 + 20, cy: 63 + row * 42, r: 9,
      fill: '#4ed8c8', stroke: '#0c3942', 'stroke-width': 2
    }));
    label(svg, x, 148, `${samples.length} цветовых отсчётов`, { 'font-size': 11 });
  }
}

function histogramWaveform(svg) {
  label(svg, 14, 27, 'Те же 16 пикселей', { 'font-weight': 700 });
  label(svg, 214, 27, 'Гистограмма', { 'font-weight': 700 });
  label(svg, 418, 27, 'Waveform', { 'font-weight': 700 });
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    svg.append(node('rect', { x: 14 + col * 29, y: 46 + row * 25, width: 28, height: 24,
      fill: col < 2 ? '#4a6b82' : '#c5e3ed', stroke: '#162633', 'stroke-width': 1 }));
  }
  frame(svg, 214, 46, 164, 101);
  svg.append(node('rect', { x: 236, y: 78, width: 42, height: 69, fill: '#4ed8c8' }));
  svg.append(node('rect', { x: 313, y: 78, width: 42, height: 69, fill: '#f3ad5c' }));
  label(svg, 240, 140, 'тёмные', { 'font-size': 10, fill: '#122330' });
  label(svg, 316, 140, 'светлые', { 'font-size': 10, fill: '#122330' });
  frame(svg, 418, 46, 184, 101);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    svg.append(node('circle', { cx: 444 + col * 43, cy: col < 2 ? 119 - row * 2 : 72 - row * 2,
      r: 3, fill: col < 2 ? '#4ed8c8' : '#f3ad5c' }));
  }
  label(svg, 427, 164, 'X кадра →', { 'font-size': 11 });
}

function analysisArea(svg) {
  for (const [index, title, x0, y0, width, height, color] of [
    [0, 'Весь кадр', 0, 0, 160, 88, '#4ed8c8'],
    [1, 'Видимая часть', 38, 10, 91, 68, '#76baff'],
    [2, 'Заданная область', 65, 24, 68, 42, '#f3ad5c']
  ]) {
    const x = 13 + index * 204;
    label(svg, x, 25, title, { 'font-weight': 700 });
    frame(svg, x, 44, 160, 88);
    for (let col = 1; col < 4; col++) svg.append(node('line', { x1: x + col * 40, y1: 45, x2: x + col * 40, y2: 131, stroke: '#466479' }));
    svg.append(node('rect', { x: x + x0, y: 44 + y0, width, height, fill: color, 'fill-opacity': 0.25,
      stroke: color, 'stroke-width': 3 }));
    label(svg, x, 153, index === 1 ? 'зависит от окна' : index === 2 ? 'общая доля кадра' : 'без кадрирования', { 'font-size': 11 });
  }
}

const diagrams = {
  chroma: { caption: 'Условная схема числа цветовых отсчётов для 4×2 пикселей; положение отсчётов у кодеков может различаться.', draw: chroma },
  'histogram-waveform': { caption: 'Гистограмма показывает частоты уровней и теряет положение; Waveform сохраняет горизонтальную координату пикселей.', draw: histogramWaveform },
  'analysis-area': { caption: 'Область анализа меняет данные графиков. Она не кадрирует сохранённый файл и не меняет основные метрики.', draw: analysisArea }
};

export function renderKnowledgeDiagram(id) {
  const diagram = diagrams[id];
  if (!diagram) throw new Error('Unknown knowledge diagram: ' + id);
  const figure = document.createElement('figure');
  figure.className = 'knowledge-diagram';
  const svg = node('svg', { viewBox: '0 0 620 175', role: 'img', 'aria-label': diagram.caption,
    preserveAspectRatio: 'xMidYMid meet' });
  svg.append(node('rect', { x: 0, y: 0, width: 620, height: 175, rx: 8, fill: '#142635' }));
  diagram.draw(svg);
  const caption = document.createElement('figcaption'); caption.textContent = diagram.caption;
  figure.append(svg, caption);
  return figure;
}
