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

function profileReading(svg) {
  label(svg, 18, 24, 'Одна линия A → B', {'font-weight':700});
  label(svg, 340, 24, 'Как прочитать переход', {'font-weight':700});
  frame(svg, 35, 43, 266, 100);
  svg.append(node('polyline', {points:'40,122 103,122 104,64 161,64 162,112 296,112',fill:'none',stroke:'#4ed8c8','stroke-width':3}));
  svg.append(node('line', {x1:104,y1:42,x2:104,y2:146,stroke:'#f3ad5c','stroke-width':2,'stroke-dasharray':'4 3'}));
  label(svg, 11, 56, '↑'); label(svg, 12, 80, 'код', {'font-size':10});
  label(svg, 35, 163, 'A'); label(svg, 266, 163, 'B →');
  label(svg, 340, 58, 'Пунктир отмечает одну позицию.');
  label(svg, 340, 82, 'Высота — уровень канала.');
  label(svg, 340, 106, 'Среднее относится ко всей линии.');
  label(svg, 340, 139, 'Профиль не описывает весь кадр.', {'font-size':12});
}

function errorMapHistogram(svg) {
  label(svg,18,25,'Где ошибка',{'font-weight':700});
  label(svg,284,25,'Как часто встречается ошибка',{'font-weight':700});
  for (const [i,value] of [0,0,0,8,0,0,8,32,0,0,8,32].entries()) {
    const x=18+i%4*45,y=40+Math.floor(i/4)*30;
    svg.append(node('rect',{x,y,width:43,height:28,fill:value===0?'#10171d':value===8?'#438e99':'#f3ad5c'}));
    label(svg,x+15,y+19,String(value),{'font-size':11,fill:value===32?'#142635':'#fff'});
  }
  for (const [i,count] of [7,3,2].entries()) {
    svg.append(node('rect',{x:304+i*87,y:130-count*11,width:44,height:count*11,fill:'#4ed8c8'}));
    label(svg,316+i*87,125-count*11,String(count),{'font-size':11});
    label(svg,319+i*87,147,String([0,8,32][i]),{'font-size':11});
  }
  label(svg,18,154,'Коды ошибки условного растра',{'font-size':11});
  label(svg,287,166,'Ошибка →; столбец — число пикселей',{'font-size':11});
}

function ssimReading(svg) {
  label(svg,18,25,'Локальное сравнение',{'font-weight':700});
  for (let i=0;i<2;i++) {
    frame(svg,18+i*149,41,127,88);
    svg.append(node('polyline',{points:`${24+i*149},114 ${66+i*149},114 ${74+i*149},55 ${137+i*149},55`,fill:'none',stroke:i?'#f3ad5c':'#4ed8c8','stroke-width':i?7:3}));
    svg.append(node('rect',{x:54+i*149,y:53,width:40,height:64,fill:'none',stroke:'#ecf4fb','stroke-dasharray':'4 3'}));
    label(svg,18+i*149,148,i?'Результат':'Исходник',{'font-size':11});
  }
  label(svg,333,56,'Сравниваются соседние отсчёты.');
  label(svg,333,83,'Число SSIM сводит результат.');
  label(svg,333,110,'Рассмотрите деталь отдельно.');
  label(svg,333,147,'SSIM — не процент качества.',{'font-size':12});
}

function waveformDensity(svg) {
  label(svg,18,25,'Один X и один уровень Y′',{'font-weight':700});
  for (const [i,title,count] of [[0,'Первый',2],[1,'Второй',3]]) {
    label(svg,20+i*119,48,title,{'font-size':12});
    for(let j=0;j<4;j++)svg.append(node('rect',{x:20+i*119+j*23,y:63,width:21,height:30,fill:j<count?'#4ed8c8':'#385267'}));
    label(svg,20+i*119,118,`${count} из 4: ${count*25}%`,{'font-size':12});
  }
  label(svg,307,55,'Разница плотностей: 75 − 50');
  label(svg,307,85,'= +25 процентных пунктов',{'font-weight':700});
  label(svg,307,122,'Это не разность яркостей пикселей.');
  label(svg,18,158,'Условные отсчёты одного столбца Waveform',{'font-size':11});
}

function errorProfileReading(svg) {
  label(svg,18,24,'Ошибка вдоль A → B',{'font-weight':700});
  frame(svg,35,43,266,100);
  svg.append(node('polyline',{points:'40,135 105,135 120,92 134,135 196,130 221,56 244,135 296,135',fill:'none',stroke:'#f3ad5c','stroke-width':3}));
  svg.append(node('line',{x1:221,y1:42,x2:221,y2:145,stroke:'#ecf4fb','stroke-dasharray':'4 3'}));
  label(svg,8,54,'%',{'font-size':11});label(svg,16,138,'0',{'font-size':11});
  label(svg,35,162,'A');label(svg,278,162,'B');
  label(svg,327,56,'Пик — место большого отклонения.');
  label(svg,327,82,'Ноль — совпадение с исходником.');
  label(svg,327,108,'Среднее относится ко всей линии.');
  label(svg,327,144,'Здесь ошибка, а не уровень RGB.',{'font-size':12});
}

const diagrams = {
  'error-map-histogram': {caption:'Один условный набор абсолютных ошибок: карта хранит положение, распределение — частоты. Числа на схеме даны в кодовых уровнях; в гистограмме ошибок приложения горизонтальная шкала нормирована на полный диапазон, по вертикали — доля пикселей.',draw:errorMapHistogram},
  'ssim-reading': {caption:'Условная схема локального сравнения перехода. Пунктир обозначает окрестность, а не реальный размер окна на этом рисунке; численный SSIM здесь не рассчитан.',draw:ssimReading},
  'waveform-density': {caption:'Пример разницы плотностей: второй график минус первый. В каждой сравниваемой группе четыре отсчёта; на выбранном уровне их два и три.',draw:waveformDensity},
  'error-profile-reading': {caption:'Условный профиль ошибки: координата пика связывает отклонение с местом на линии; высота — ошибка в процентах полного диапазона.',draw:errorProfileReading},
  'profile-reading': {caption:'Условный профиль одного канала: переход относится к отмеченной позиции линии, а среднее объединяет все её отсчёты.',draw:profileReading},
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
