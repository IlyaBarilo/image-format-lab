// Own image scopes UI, MIT. These are established analysis methods.
import { differenceColor } from '../core/difference.mjs';
import { profileBinAt } from '../core/line-profile.mjs';
const CHANNELS = { rgb: [0, 1, 2], r: [0], g: [1], b: [2], alpha: [3], y: [4] };
const NAMES = ['R', 'G', 'B', 'α', 'Y′'];
const COLORS = ['#fb7185', '#4ade80', '#60a5fa', '#e2e8f0'];
const number = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });

export function createAnalysis({ app }, deps) {
  const get = id => document.getElementById(id);
  const panel = get('analysisPanel'), body = get('analysisBody'), collapse = get('analysisCollapse');
  const channel = get('analysisChannel'), matte = get('analysisMatte');
  const type = get('analysisType');
  const differenceChannel = get('analysisDifferenceChannel'), gain = get('analysisGain');
  const profileChannel = get('analysisProfileChannel'), position = get('analysisPosition');
  const level = get('analysisLevel'), status = get('analysisStatus');
  const help = get('analysisHelp'), helpContent = get('analysisHelpContent'), details = get('analysisDetails');
  const cards = [...panel.querySelectorAll('.analysis-card')].map(element => ({
    element, info: element.querySelector('.analysis-info'), canvas: element.querySelector('canvas'),
    values: element.querySelector('.analysis-values'), badge: element.querySelector('.analysis-index')
  }));
  let redrawFrame = 0;
  let attached = false, generation = 0, queued = false, running = false;
  let cache = new WeakMap(), lastSource = null, results = [];
  let lastRegionKey = '';
  let viewportRegions = [], viewportKey = '', viewportTimer = null;
  let resizePaused = false, resizeNeedsUpdate = false;
  const followsViewport = () => deps.getAnalysisScope() === 'viewport' && type.value !== 'tradeoff';
  const readViewports = () => cards.slice(0, app.layout).map((_, side) => deps.getAnalysisViewport(side));

  function syncControls() {
    deps.syncAnalysisOutput();
    const tradeoff=type.value==='tradeoff',output=deps.getAnalysisOutputSettings();
    get('analysisScope').hidden=tradeoff;
    get('analysisMatteField').hidden=tradeoff;
    const difference = type.value === 'difference', spatial = ['waveform','parade'].includes(type.value);
    const profile = type.value === 'profile', vector = type.value === 'vectorscope';
    get('analysisChannelField').hidden = type.value !== 'histogram';
    get('analysisLevelField').hidden = type.value !== 'histogram';
    get('analysisProfileField').hidden = !profile;
    get('analysisPositionField').hidden = !profile;
    get('analysisLineOpen').hidden = !profile;
    get('analysisDifferenceField').hidden = !difference;
    get('analysisGainField').hidden = !difference;
    get('analysisDifferenceLegend').hidden = !difference;
    get('analysisDifferenceLimit').textContent = `≥ ${number(255/Number(gain.value))}`;
    matte.disabled = profile ? profileChannel.value === 'alpha' : vector ? false : difference ? differenceChannel.value === 'alpha' : !spatial && channel.value === 'alpha';
    panel.dataset.type = type.value;
    help.title = spatial
      ? 'По горизонтали — положение в кадре, по вертикали — уровень 0–255. Чем светлее след, тем больше пикселей. Нажмите для подробностей.'
      : 'По горизонтали — уровни 0–255, по вертикали — доля пикселей. Шкала общая. Нажмите для подробностей.';
    get('analysisMethod').textContent = spatial
      ? 'Графики 1–4 следуют ячейкам сравнения. По горизонтали — положение слева направо (0–100% ширины кадра); в RGB Parade оно повторяется для R, G и B. По вертикали — кодовые уровни 0–255. Waveform: Y′ = round(0,2126 R + 0,7152 G + 0,0722 B), коэффициенты BT.709 применены к RGB8 после смешивания с выбранной подложкой. Это оценка сигнала, не линейная физическая яркость, HDR или IRE. Все пиксели учитываются; соседние столбцы объединяются максимум в 256 групп, уровни не усредняются. Плотность — доля пикселей группы на данном уровне. Яркость следа пропорциональна корню четвёртой степени из плотности относительно общего максимума всех видимых графиков и каналов. Фон и масштаб просмотра на расчёт не влияют.'
      : 'Графики 1–4 автоматически показывают результаты соответствующих ячеек сравнения с их форматами и настройками. По горизонтали — уровни 0–255, по вертикали — доля пикселей канала в процентах. Шкала общая для всех видимых графиков. Считаются все пиксели кадра RGBA 8 бит. RGB учитывает выбранную подложку, α измеряется отдельно. Фон и масштаб просмотра не влияют на анализ.';
    if(difference) {
      help.title = 'Отличие каждой ячейки от исходного файла. Чёрный — совпадение, цвет — величина ошибки. Усиление общее. Нажмите для подробностей.';
      get('analysisMethod').textContent = 'Каждая ячейка сравнивается с исходным файлом, включая первую. RGB: максимум абсолютных разностей R/G/B после округления композиции с общей подложкой; α: абсолютная разность прозрачности без подложки. Это различия кодовых значений RGBA8, не Delta E и не оценка восприятия. Чёрный означает нулевую разность, цвет показывает величину от 0 до 255. Общее усиление умножает только отображаемую разность; красный — достижение или превышение верхнего порога шкалы. Средние/максимумы считаются по всем выбранным пикселям без усиления. Карта ограничена 512 пикселями по длинной стороне; каждая её точка хранит максимальную ошибку группы, чтобы не терять единичные отличия. Размеры результата и исходника должны совпадать: масштабирования или выравнивания по содержимому нет.';
    }
    if(vector){
      help.title='Центр — нейтральные цвета. Направление и удаление показывают цветность. Плотность и шкалы общие для всех ячеек. Нажмите для подробностей.';
      get('analysisMethod').textContent='Вектороскоп учитывает все пиксели выбранной области RGB8 после композиции с общей подложкой. Y = 0,2126 R + 0,7152 G + 0,0722 B; Cb = (B−Y)/(1,8556×255), Cr = (R−Y)/(1,5748×255), коэффициенты BT.709. Cb растёт вправо, Cr вверх, обе оси от −0,5 до 0,5. Нейтральные значения в центре. Ориентиры R/M/B/C/G/Y соответствуют RGB-цветам с каналами 0/255; окружности — радиусы 0,25 и 0,5, не проценты насыщенности HSV или границы допустимого видео. Плотность считается в сетке 257×257, нормируется на число пикселей области; яркость следа — корень четвёртой степени плотности относительно общего максимума всех ячеек. Это анализ декодированных кодовых значений, не HDR, Delta E, проверка ICC или вещательных уровней.';
    }
    if(profile){
      help.title='Профиль значений вдоль общей линии A→B. Уровни 0–255; положение и каналы общие. Линию можно выбрать на миниатюре. Нажмите для подробностей.';
      get('analysisMethod').textContent='Профиль показывает ближайшие пиксели дискретной линии A→B внутри выбранной области. Шаг — один пиксель по её более длинной проекции, оба конца включены. По горизонтали положение от A (0%) до B (100%), по вертикали кодовые уровни 0–255. RGB смешивается с выбранной подложкой, α измеряется отдельно; Y′ = round(0,2126 R + 0,7152 G + 0,0722 B). До 1024 групп: линия графика показывает среднее группы, вертикальные отрезки — её минимум/максимум, чтобы сохранить узкие пики длинной линии. Указатель выбирает группу ближайшего пикселя. Одна точка или растр 1×1 дают один отсчёт. При разных размерах относительная линия одинакова, число отсчётов и координаты отличаются. «Линия…» редактирует черновик; применение обновляет все профили, отмена отбрасывает изменения. Это кодовые значения, не линейная физическая яркость.';
    }
    get('analysisMethod').textContent += ' Пункт «Заданная область» в списке области анализа открывает редактор общего прямоугольника в долях кадра для всех графиков. Повторный выбор этого пункта открывает сохранённую область для правки. Пограничные пиксели включаются целиком. Горизонталь Waveform/Parade 0–100% относится к выбранной области. При смене файла ручная область сбрасывается; сохраняемые изображения и основные метрики не кадрируются.';
    if(output.display==='overlay')get('analysisMethod').textContent+=' Наложение сравнивает выбранную пару ячеек. Для гистограммы и профиля первый график — приглушённая пастельная заливка до нуля с тонкой границей, второй — насыщенный сплошной контур поверх неё с тёмной окантовкой. Цвета соответствуют каналам: пастельные R/G/B у заливки, насыщенные R/G/B у контура. Числа ячеек и роли подписаны в легенде. У профиля сохранены отрезки минимума/максимума групп; один отсчёт показан заполненной точкой и кольцом. Для Waveform/Parade/вектороскопа первый след голубой, второй оранжевый; пересечение складывает свет обоих следов. Нормировка общая для выбранной пары. Изменение пары/вида не запускает кодирование или Worker.';
    if(output.display==='delta'){
      help.title='Разница графиков: вторая выбранная ячейка минус первая. Ноль означает совпадение графиков. Нажмите для методики и единиц.';
      get('analysisMethod').textContent='«Разница» вычитает график первой выбранной ячейки из второй; порядок подписан, например Δ 2 − 1. Используются уже рассчитанные графики текущих результатов и выбранной области. Плюс означает увеличение во второй ячейке, минус — уменьшение. RGB учитывает подложку анализа, α измеряется отдельно. ' + (spatial
        ? 'Waveform и RGB Parade сохраняют горизонталь 0–100% ширины области и вертикаль кодовых уровней 0–255. Вычитаются доли пикселей на каждом уровне каждой группы столбцов, в процентных пунктах. При разном числе групп плотности сначала нормируются на размер своей группы, затем приводятся к общей относительной сетке с весами пересечения групп. Оранжевый — прибавление, голубой — уменьшение, тёмный фон — ноль. Интенсивность — корень четвёртой степени модуля разности относительно общего максимума выбранных каналов; предел подписан в легенде. При уменьшении Canvas сохраняется значение с наибольшим модулем в экранной точке, чтобы не погасить противоположные отличия усреднением.'
        : profile
          ? 'Профиль вычитает средние групп вдоль относительной линии A→B. При разном числе групп используется линейная интерполяция кривых в общих позициях; единственный отсчёт постоянен. По вертикали — разность кодовых уровней, шкала симметрична относительно нуля. Минимумы/максимумы групп не вычитаются: такой интервал не был бы диапазоном попиксельных ошибок. Указатель показывает разницу в текущей относительной позиции.'
          : 'Гистограмма вычитает доли пикселей на каждом уровне 0–255. По вертикали — процентные пункты, например 12% − 10% = +2 п.п. Разное число пикселей само по себе не создаёт разницу. Шкала симметрична относительно нуля и общая для выбранных каналов; указатель показывает разницу на выбранном уровне.') + ' Сопоставление выполняется в координатах графиков, без выравнивания содержимого изображений. Режим не запускает новое кодирование или Worker. В JSON сохранены оба графика и подписанные массивы разницы; PNG содержит график, единицы и порядок вычитания.';
    }
    if(tradeoff){
      help.title='Точки текущих ячеек: размер по горизонтали, выбранная метрика по вертикали. Данные уже готовых результатов; нажмите для методики.';
      get('analysisMethod').textContent='Точки соответствуют текущим готовым ячейкам, номера совпадают. По горизонтали размер файла в КБ (1000 байт), по вертикали выбранная метрика: PSNR RGB на белой подложке (выше — меньше ошибка), средняя абсолютная ошибка alpha в процентах от 255 (ниже — лучше) или время обработки в мс, включая ожидание, декодирование и метрики. Это не изолированная скорость кодировщика. PSNR ∞ означает совпадение видимого RGB и показан в отдельной полосе, без подмены конечным числом. Одинаковые точки не сдвигаются, разнесены только номера; все значения есть в легенде. Точки не соединяются: перебора качества и интерполяции нет. Метрики взяты из основного сравнения всего изображения с декодированным исходником, область/линия/подложка панели на них не влияют. При несовпадении размеров PSNR/ошибка alpha недоступны. Устаревшие, ошибочные или отсутствующие метрики не получают точек.';
    }
    get('analysisCaveat').textContent=tradeoff?'Числа не заменяют визуальную оценку; время зависит от устройства и нагрузки. Подробности по текущим ячейкам:':'Одинаковые графики не гарантируют совпадения изображений. При разных размерах сравниваются распределения выбранной области без выравнивания, а не только потери кодека. Подробности по текущим ячейкам:';
    if (followsViewport()) {
      get('analysisMethod').textContent = get('analysisMethod').textContent
        .replace('Фон и масштаб просмотра на расчёт не влияют.', '')
        .replace('Фон и масштаб просмотра не влияют на анализ.', '')
        .replace('Считаются все пиксели кадра RGBA 8 бит.', 'Считаются пиксели видимой части RGBA 8 бит.');
      get('analysisMethod').textContent += ' Режим «Видимая часть» берёт фактический фрагмент каждой ячейки с учётом масштаба и перемещения. Пиксели на границе включаются целиком, фон вне изображения исключён. При разных размерах окон/результатов области могут различаться; их точные координаты записаны в данных графиков. В максимуме используются последние размеры окон просмотра. Линия A→B задаётся относительно видимой области каждой ячейки; её редактор показывает исходник в окне первой ячейки. Основные метрики и сохраняемые изображения остаются полными.';
    }
  }

  function syncLayout() {
    panel.querySelector('.analysis-plots').dataset.layout = String(app.layout);
    cards.forEach((card, index) => { card.element.hidden = index >= app.layout; });
    deps.syncAnalysisLayout();
  }

  function selected(side) {
    const variant = app.variants[side], c = variant?.config;
    const quality = c && ['jpeg', 'webp', 'heic', 'avif', 'jxl'].includes(c.format) ? ` · качество ${c.quality}`
      : c && ['gif', 'gifenc'].includes(c.format) ? ` · ${c.gifColors} цветов` : '';
    const label = `${side + 1} · ${c ? deps.outputFormatLabel(c.format) : 'Нет результата'}${quality}`;
    if (!app.source) return { label, message: 'Добавьте изображение для анализа.' };
    if (app.sourceLoading) return { label, message: 'Исходник открывается…' };
    if (!variant || side >= app.layout) return { label, message: 'Вариант скрыт.' };
    if (variant.error) return { label, message: `Ошибка результата: ${variant.error}` };
    if (!deps.isVariantReady(variant)) return { label, message: variant.processing ? 'Результат пересчитывается…' : 'Параметры изменены. Нажмите «Применить».' };
    if(type.value === 'difference' && (variant.imageData.width !== app.source.width || variant.imageData.height !== app.source.height))
      return {label,message:`Карта требует одинаковых размеров: ${variant.imageData.width}×${variant.imageData.height}, исходник ${app.source.width}×${app.source.height}.`};
    const viewport = followsViewport() ? viewportRegions[side] : null;
    if (followsViewport() && !viewport?.region) return { label, message: viewport?.message || 'Определяю видимую часть…' };
    return { label, imageData: variant.imageData,region:viewport?.region || deps.getAnalysisRegion(),config:{...variant.resultConfig},measurement:{...variant.measurement} };
  }

  function clearPlots() {
    results = [];
    details.textContent = '';
    for (const card of cards) {
      card.canvas.hidden = true;
      card.canvas.getContext('2d').clearRect(0, 0, card.canvas.width, card.canvas.height);
      card.values.textContent = '';
      card.values.removeAttribute('title');
      card.info.hidden = true;
      card.badge.removeAttribute('title');
      delete card.element.dataset.state;
      delete card.canvas.dataset.yMax;
      delete card.canvas.dataset.densityMax;
      delete card.canvas.dataset.kind;
      delete card.canvas.dataset.gain;
      delete card.canvas.dataset.mean;
      delete card.canvas.dataset.profileSamples;
    }
  }

  function updateAnalysis({ defer = false } = {}) {
    if (!attached) return;
    if (resizePaused) { resizeNeedsUpdate = true; return; }
    clearTimeout(viewportTimer); viewportTimer = null;
    generation++;
    deps.syncAnalysisRegion();
    viewportRegions = followsViewport() ? readViewports() : [];
    viewportKey = JSON.stringify(viewportRegions);
    const regionKey = JSON.stringify([deps.getAnalysisScope(),deps.getAnalysisRegion(),deps.getAnalysisLine(),viewportRegions]);
    if (lastSource !== app.source || regionKey !== lastRegionKey) { cache = new WeakMap(); lastSource = app.source; lastRegionKey = regionKey; }
    syncLayout();
    syncControls();
    clearPlots();
    deps.presentAnalysis(getAnalysisSnapshot());
    queued = false;
    if (body.hidden) return;
    cards.forEach((card, side) => {
      if (card.element.hidden) return;
      const input = selected(side);
      card.info.textContent = input.message || (type.value==='profile'?'Считаю пиксели линии…':followsViewport()?'Считаю видимую часть…':'Считаю все пиксели…');
      card.info.hidden = false;
      card.element.dataset.state = input.imageData ? 'pending' : 'unavailable';
    });
    status.textContent = '';
    const enqueue = () => { viewportTimer = null; queued = !body.hidden; queueMicrotask(drain); };
    if (defer) viewportTimer = setTimeout(enqueue, 120); else enqueue();
  }

  function updateAnalysisViewport() {
    if (!attached || resizePaused || !followsViewport() || JSON.stringify(readViewports()) === viewportKey) return;
    // Invalidate immediately, but wait for a pause in pan/zoom before cloning pixels to the Worker.
    updateAnalysis({ defer: true });
  }

  function pauseAnalysisForResize() {
    if (resizePaused) return;
    resizePaused = true;
    resizeNeedsUpdate = queued || running || viewportTimer !== null;
    generation++; // Also invalidate any PNG export already in flight; keep the visible plots.
    clearTimeout(viewportTimer); viewportTimer = null; queued = false;
  }

  function resumeAnalysisAfterResize() {
    if (!resizePaused) return;
    resizePaused = false;
    const pending = resizeNeedsUpdate;
    resizeNeedsUpdate = false;
    if (pending || followsViewport() && JSON.stringify(readViewports()) !== viewportKey) updateAnalysis();
  }

  async function compute(imageData, background, kind, region, reference, line) {
    const activeCache = cache;
    let entry = cache.get(imageData);
    const key = `${kind}:${background}:${JSON.stringify(region)}`;
    if (entry?.has(key)) return entry.get(key);
    if (typeof Worker === 'undefined') throw new Error('Для анализа нужен браузер с поддержкой Worker.');
    // workerCompute clones the payload: the viewer retains ownership of its pixels.
    const result = await deps.workerCompute(kind, { imageData, matte: background, region, ...(kind === 'difference' ? {reference} : {}), ...(kind === 'profile' ? {line} : {}) });
    entry ??= new Map();
    entry.set(key, result);
    if(cache === activeCache) cache.set(imageData, entry);
    return result;
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queued && !body.hidden && !resizePaused) {
        queued = false;
        const token = generation, inputs = cards.slice(0, app.layout).map((_, side) => selected(side)), background = matte.value;
        const kind = type.value === 'parade' ? 'waveform' : type.value;
        const reference = app.source?.imageData, line=deps.getAnalysisLine();
        const computed = [];
        for (const input of inputs) {
          if (input.imageData) {
            try { computed.push({ ...input, data: kind==='tradeoff'?{width:input.imageData.width,height:input.imageData.height}:await compute(input.imageData, background, kind, input.region, reference, line) }); }
            catch (error) { computed.push({ label: input.label, message: error.message || String(error) }); }
          } else computed.push(input);
          if (token !== generation || body.hidden || resizePaused) break;
        }
        if (token !== generation || body.hidden || resizePaused) continue;
        // Keep only compact bins/labels; do not retain another reference to a source raster.
        results = computed.map(({ label, message, data, config, measurement }) => ({ label, message, data, config, measurement }));
        drawAnalysis();
      }
    } finally { running = false; }
  }

  function drawAnalysis() {
    if (body.hidden || resizePaused) return;
    syncControls();
    if(deps.getAnalysisOutputSettings().display==='separate')drawIndividualAnalysis();
    deps.presentAnalysis(getAnalysisSnapshot());
  }

  function getAnalysisSnapshot(){
    const output=deps.getAnalysisOutputSettings(),kind=type.value;
    const settings=kind==='tradeoff'?{type:kind,display:'metrics',metric:output.metric}:{type:kind,display:output.display,...(['overlay','delta'].includes(output.display)?{pair:output.pair}:{}),matte:matte.value,scope:deps.getAnalysisScope(),region:deps.getAnalysisRegion(),...(followsViewport()?{viewports:viewportRegions.map((v,i)=>({cell:i+1,...v}))}:{}),...(kind==='histogram'?{channel:channel.value,level:Number(level.value)}:kind==='profile'?{profileChannel:profileChannel.value,position:Number(position.value),line:deps.getAnalysisLine()}:kind==='difference'?{differenceChannel:differenceChannel.value,gain:Number(gain.value)}:{})};
    return {version:1,revision:generation,source:app.source?{name:app.source.name,width:app.source.width,height:app.source.height,bytes:app.source.size}:null,settings,method:get('analysisMethod').textContent,
      items:cards.slice(0,app.layout).map((_,i)=>{const current=selected(i),item=results[i];return {cell:i+1,label:current.label,status:current.imageData&&item?.data?'ready':'unavailable',message:current.message||item?.message||(!item?'Расчёт…':null),config:item?.data&&current.imageData?item.config:null,measurement:item?.data&&current.imageData?item.measurement:null,data:current.imageData?item?.data||null:null};})};
  }

  function drawIndividualAnalysis() {
    if (body.hidden || !results.length) return;
    if (type.value === 'difference') { drawDifference(); return; }
    if (type.value === 'vectorscope' || type.value === 'profile') { drawExtraScopes(); return; }
    if (type.value !== 'histogram') { drawSpatial(); return; }
    const indices = CHANNELS[channel.value], bin = Number(level.value);
    let maximum = 0;
    for (const item of results) if (item.data) for (const index of indices) {
      for (const count of item.data.channels[index]) maximum = Math.max(maximum, count / item.data.pixelCount * 100);
    }
    maximum = maximum || 1;
    get('analysisLevelValue').textContent = String(bin);
    matte.disabled = channel.value === 'alpha';
    const detailLines = [];
    cards.forEach((card, side) => {
      if (card.element.hidden) return;
      const item = results[side], h = item?.data;
      if (!h) {
        card.element.dataset.state = 'unavailable';
        card.info.textContent = item?.message || 'Нет результата.';
        card.info.hidden = false;
        card.canvas.hidden = true;
        card.values.textContent = '';
        return;
      }
      card.element.dataset.state = 'ready';
      card.info.textContent = '';
      card.info.hidden = true;
      const description = `${rasterDescription(h)} · ${channel.value === 'alpha' ? 'α без подложки' : `RGB на ${h.matte === 'white' ? 'белом' : 'чёрном'}`}`;
      card.badge.title = `${item.label}. ${description}`;
      card.canvas.hidden = false;
      card.canvas.dataset.yMax = String(maximum);
      card.canvas.dataset.kind = 'histogram';
      const values = indices.map(index => `${NAMES[index]} ${number(h.channels[index][bin] / h.pixelCount * 100)}%`).join(' · ');
      const means = indices.map(index => {
        const mean = h.channels[index].reduce((sum, count, value) => sum + count * value, 0) / h.pixelCount;
        return `${NAMES[index]} ${number(mean)}`;
      }).join(' · ');
      card.values.textContent = values;
      card.values.title = `Уровень ${bin}. Средние: ${means}.`;
      detailLines.push(`${item.label}: ${description}. Средние: ${means}.`);
      card.canvas.setAttribute('aria-label', `${item.label}. ${description}. Гистограмма ${indices.map(i => NAMES[i]).join(', ')}. Уровень ${bin}: ${values}. Средние: ${means}.`);
      plot(card.canvas, h, indices, maximum, bin);
    });
    details.textContent = detailLines.join('\n');
    updateSizeNote();
  }

  function updateSizeNote() {
    const sizes = [...new Set(results.filter(item => item.data).map(({ data: h }) => `${h.width}×${h.height}`))];
    status.textContent = sizes.length > 1
      ? `Размеры различаются: ${sizes.join(', ')}. ${['histogram','vectorscope'].includes(type.value) ? 'Сравниваются распределения выбранной области кадра.' : type.value === 'profile' ? 'Линия задана относительно области; координаты пикселей и число отсчётов различаются.' : 'Горизонталь нормирована по ширине выбранной области каждого кадра.'}` : '';
  }

  function drawExtraScopes() {
    const vector=type.value==='vectorscope',indices=CHANNELS[profileChannel.value],cursor=Number(position.value);
    let maximum=0;
    if(vector)for(const item of results)if(item.data)for(const count of item.data.bins)maximum=Math.max(maximum,count/item.data.pixelCount);
    maximum=maximum||1;
    get('analysisPositionValue').textContent=number(cursor/10)+'%';
    const lines=[];
    cards.forEach((card,side)=>{
      if(card.element.hidden)return;
      const item=results[side],data=item?.data;
      if(!data){card.element.dataset.state='unavailable';card.info.textContent=item?.message||'Нет результата.';card.info.hidden=false;card.canvas.hidden=true;card.values.textContent='';return;}
      card.element.dataset.state='ready';card.info.hidden=true;card.canvas.hidden=false;card.canvas.dataset.kind=type.value;
      const description=`${rasterDescription(data)} · ${!vector&&profileChannel.value==='alpha'?'α без подложки':`RGB на ${data.matte==='white'?'белом':'чёрном'}`}`;
      let detail;
      if(vector){
        card.canvas.dataset.yMax='0.5';card.canvas.dataset.densityMax=String(maximum);
        detail=`Вектороскоп: Cb вправо, Cr вверх; оси −0,5…0,5. Средняя цветность: Cb ${number(data.meanCb)}, Cr ${number(data.meanCr)}.`;
        card.values.textContent='';card.values.removeAttribute('title');
        deps.plotVectorscope(card.canvas,data,maximum);
      }else{
        const bin=profileBinAt(data,cursor),p=data.points;
        const values=indices.map(index=>{const c=data.channels[index];return `${NAMES[index]} ${number(c.mean[bin])}${data.counts[bin]>1?` [${c.min[bin]}–${c.max[bin]}]`:''}`;}).join(' · ');
        card.canvas.dataset.yMax='255';card.canvas.dataset.profileSamples=String(data.sampleCount);
        card.values.textContent=values;
        card.values.title=`${number(cursor/10)}% от A к B. ${data.counts[bin]} отсчётов в группе; в скобках минимум–максимум.`;
        detail=`Профиль A (${p.x0}, ${p.y0}) → B (${p.x1}, ${p.y1}): ${number(data.sampleCount)} отсчётов, ${data.bins} групп. Положение ${number(cursor/10)}%: ${values}. Уровни 0–255.`;
        deps.plotLineProfile(card.canvas,data,indices,cursor);
      }
      card.badge.title=`${item.label}. ${description}`;
      card.canvas.setAttribute('aria-label',`${item.label}. ${description}. ${detail}`);
      lines.push(`${item.label}: ${description}. ${detail}`);
    });
    details.textContent=lines.join('\n');updateSizeNote();
  }

  function rasterDescription(data) {
    const b = data.bounds;
    return `${data.width}×${data.height} · ${number(data.pixelCount)} пикселей` +
      (b && (b.x || b.y || b.width !== data.width || b.height !== data.height) ? ` · область ${b.x}, ${b.y}: ${b.width}×${b.height}` : '');
  }

  function drawDifference() {
    const index = differenceChannel.value === 'alpha' ? 1 : 0, amplification = Number(gain.value), lines = [];
    const palette = Array.from({length:256},(_,error)=>differenceColor(error,amplification));
    cards.forEach((card,side)=>{
      if(card.element.hidden)return;
      const item=results[side], data=item?.data;card.values.textContent='';
      if(!data){card.element.dataset.state='unavailable';card.info.textContent=item?.message||'Нет результата.';card.info.hidden=false;card.canvas.hidden=true;return;}
      card.element.dataset.state='ready';card.info.hidden=true;card.canvas.hidden=false;
      card.canvas.dataset.kind='difference';card.canvas.dataset.gain=String(amplification);card.canvas.dataset.mean=String(data.means[index]);
      const description=`${rasterDescription(data)}. ${index ? 'α без подложки' : `RGB на ${data.matte === 'white' ? 'белом' : 'чёрном'}`}`;
      const summary=`Средняя разность ${number(data.means[index])}; максимум ${data.maxima[index]}; отличаются ${number(data.changed[index]/data.pixelCount*100)}% пикселей.`;
      const label=`${item.label}. Различия с исходником. ${description}. ${summary} Усиление ×${amplification}.`;
      card.canvas.setAttribute('aria-label',label);card.badge.title=label;lines.push(label);
      const canvas=card.canvas, rect=canvas.getBoundingClientRect(), dpr=Math.max(1,Math.min(2.5,devicePixelRatio||1));
      canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#101923';ctx.fillRect(0,0,canvas.width,canvas.height);
      const scale=Math.min((canvas.width-16*dpr)/data.bounds.width,(canvas.height-30*dpr)/data.bounds.height);
      const width=Math.max(1,Math.round(data.bounds.width*scale)),height=Math.max(1,Math.round(data.bounds.height*scale));
      const cols=Math.min(data.mapWidth,width),rows=Math.min(data.mapHeight,height), pooled=new Uint8Array(cols*rows);
      for(let y=0;y<data.mapHeight;y++)for(let x=0;x<data.mapWidth;x++){
        const p=Math.floor(y*rows/data.mapHeight)*cols+Math.floor(x*cols/data.mapWidth);
        pooled[p]=Math.max(pooled[p],data.maps[index][y*data.mapWidth+x]);
      }
      const raster=document.createElement('canvas');raster.width=cols;raster.height=rows;
      const rc=raster.getContext('2d'),pixels=rc.createImageData(cols,rows);
      for(let i=0;i<pooled.length;i++){pixels.data.set(palette[pooled[i]],i*4);pixels.data[i*4+3]=255;}
      rc.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;
      ctx.drawImage(raster,(canvas.width-width)/2,26*dpr+(canvas.height-30*dpr-height)/2,width,height);
    });
    details.textContent=lines.join('\n');status.textContent='';
  }

  function drawSpatial() {
    const indices = type.value === 'parade' ? [0, 1, 2] : [3];
    let maximum = 0;
    for (const { data } of results) if (data) for (const index of indices) {
      for (let x = 0; x < data.columns; x++) for (let value = 0; value < 256; value++) {
        maximum = Math.max(maximum, data.channels[index][x * 256 + value] / data.columnPixels[x]);
      }
    }
    maximum ||= 1;
    const detailLines = [];
    cards.forEach((card, side) => {
      if (card.element.hidden) return;
      const item = results[side], data = item?.data;
      card.values.textContent = '';
      if (!data) {
        card.element.dataset.state = 'unavailable';
        card.info.textContent = item?.message || 'Нет результата.';
        card.info.hidden = false; card.canvas.hidden = true;
        return;
      }
      card.element.dataset.state = 'ready';
      card.info.hidden = true; card.canvas.hidden = false;
      card.canvas.dataset.kind = type.value;
      card.canvas.dataset.yMax = '255';
      card.canvas.dataset.densityMax = String(maximum);
      const summary = indices.map(index => {
        let low = 255, high = 0, sum = 0;
        data.channels[index].forEach((count, position) => {
          if (!count) return;
          const value = position % 256;
          low = Math.min(low, value); high = Math.max(high, value); sum += value * count;
        });
        return `${index === 3 ? 'Y′' : NAMES[index]} ${low}–${high}, среднее ${number(sum / data.pixelCount)}`;
      }).join(' · ');
      const description = `${rasterDescription(data)} · ${data.columns} групп столбцов · RGB на ${data.matte === 'white' ? 'белом' : 'чёрном'}`;
      card.badge.title = `${item.label}. ${description}`;
      const label = `${item.label}. ${description}. ${type.value === 'parade' ? 'RGB Parade' : 'Waveform Y′'}. Уровни 0–255, ширина кадра 0–100%. ${summary}.`;
      card.canvas.setAttribute('aria-label', label);
      detailLines.push(label);
      plotSpatial(card.canvas, data, indices, maximum);
    });
    details.textContent = detailLines.join('\n');
    updateSizeNote();
  }

  function plotSpatial(canvas, data, indices, maximum) {
    const rect = canvas.getBoundingClientRect(), width = rect.width, height = rect.height;
    const dpr = Math.max(1, Math.min(2.5, devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, width, height);
    const left = 36, top = 28, bottom = height - 25, right = width - 12, gap = 12;
    const planeWidth = (right - left - gap * (indices.length - 1)) / indices.length;
    ctx.font = '11px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const y = value => bottom - (bottom - top) * value / 255;
    for (const value of [0, 64, 128, 192, 255]) {
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'right'; ctx.fillText(String(value), left - 5, y(value));
    }
    indices.forEach((index, plane) => {
      const start = left + plane * (planeWidth + gap);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      for (const value of [0, 64, 128, 192, 255]) {
        ctx.beginPath(); ctx.moveTo(start, y(value)); ctx.lineTo(start + planeWidth, y(value)); ctx.stroke();
      }
      const raster = document.createElement('canvas'); raster.width = data.columns; raster.height = 256;
      const rasterCtx = raster.getContext('2d'), pixels = rasterCtx.createImageData(data.columns, 256);
      const color = index === 3 ? [226, 232, 240] : index === 0 ? [251, 113, 133] : index === 1 ? [74, 222, 128] : [96, 165, 250];
      for (let x = 0; x < data.columns; x++) for (let value = 0; value < 256; value++) {
        const count = data.channels[index][x * 256 + value];
        if (!count) continue;
        const p = ((255 - value) * data.columns + x) * 4;
        pixels.data[p] = color[0]; pixels.data[p + 1] = color[1]; pixels.data[p + 2] = color[2];
        pixels.data[p + 3] = Math.round(255 * Math.pow(count / data.columnPixels[x] / maximum, 0.25));
      }
      rasterCtx.putImageData(pixels, 0, 0);
      // Preserve narrow peaks when a spatial/signal bin is smaller than a display pixel.
      // Max pooling is only a drawing operation; underlying counts stay exact.
      const rows = Math.min(256, Math.max(1, Math.round((bottom - top) * dpr)));
      const columns = Math.min(data.columns, Math.max(1, Math.round(planeWidth * dpr)));
      if (rows < 256 || columns < data.columns) {
        const reduced = rasterCtx.createImageData(columns, rows);
        for (let row = 0; row < 256; row++) for (let x = 0; x < data.columns; x++) {
          const from = (row * data.columns + x) * 4;
          const to = (Math.floor(row * rows / 256) * columns + Math.floor(x * columns / data.columns)) * 4;
          if (pixels.data[from + 3] > reduced.data[to + 3]) reduced.data.set(pixels.data.subarray(from, from + 4), to);
        }
        raster.width = columns; raster.height = rows; rasterCtx.putImageData(reduced, 0, 0);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(raster, start, top, planeWidth, bottom - top);
      ctx.textAlign = 'center'; ctx.fillStyle = COLORS[index];
      ctx.fillText(index === 3 ? 'Y′' : NAMES[index], start + planeWidth / 2, 12);
      ctx.fillStyle = '#cbd5e1';
      for (const ratio of indices.length === 1 ? [0, 0.5, 1] : [0, 1]) {
        ctx.textAlign = ratio === 0 ? 'left' : ratio === 1 ? 'right' : 'center';
        ctx.fillText(`${ratio * 100}%`, start + planeWidth * ratio, height - 10);
      }
    });
  }

  function plot(canvas, histogram, indices, maximum, bin) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    const dpr = Math.max(1, Math.min(2.5, devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, width, height);
    const left = 56, top = 28, bottom = height - 25, right = width - 16;
    const x = value => left + (right - left) * value / 255;
    const y = percent => bottom - (bottom - top) * percent / maximum;
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const ratio of [0, 0.5, 1]) {
      const py = y(maximum * ratio);
      ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'right';
      ctx.fillText(`${number(maximum * ratio)}%`, left - 5, py, left - 7);
    }
    for (const value of [0, 64, 128, 192, 255]) {
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'center'; ctx.fillText(String(value), x(value), height - 10);
    }
    for (const index of indices) {
      ctx.strokeStyle = COLORS[index]; ctx.lineWidth = 1.3; ctx.beginPath();
      histogram.channels[index].forEach((count, value) => {
        const py = y(count / histogram.pixelCount * 100);
        if (value === 0) ctx.moveTo(x(value), py); else ctx.lineTo(x(value), py);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(bin), top); ctx.lineTo(x(bin), bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    indices.slice().reverse().forEach((index, offset) => {
      ctx.fillStyle = COLORS[index]; ctx.fillText(NAMES[index], right - offset * 20, 3);
    });
  }

  function setExpanded(open) {
    if (body.hidden === !open) return;
    body.hidden = !open;
    collapse.setAttribute('aria-expanded', String(open));
    if (!open) { setHelpOpen(false); deps.closeAnalysisRegion(); }
    updateAnalysis();
    deps.drawAll();
    scheduleRedraw();
  }

  function scheduleRedraw() {
    if (redrawFrame || body.hidden || resizePaused) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = 0;
      if (body.hidden || resizePaused) return;
      drawAnalysis();
      deps.drawAnalysisRegion();
    });
  }

  function setHelpOpen(open) {
    helpContent.hidden = !open;
    help.setAttribute('aria-expanded', String(open));
  }

  function attachAnalysisEvents() {
    attached = true;
    deps.attachAnalysisRegionEvents();
    deps.attachAnalysisOutputEvents();
    deps.attachAnalysisLayoutEvents();
    help.addEventListener('click', () => setHelpOpen(helpContent.hidden));
    get('analysisScope').addEventListener('change',()=>setHelpOpen(false));
    get('analysisLineOpen').addEventListener('click',()=>{setHelpOpen(false);deps.toggleAnalysisLine();});
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !helpContent.hidden) {
        event.preventDefault(); event.stopPropagation(); setHelpOpen(false); help.focus();
      } else if (event.key === 'Escape' && deps.restoreAnalysisLayout()) {
        event.preventDefault(); event.stopPropagation();
      }
    });
    matte.addEventListener('change', updateAnalysis);
    type.addEventListener('change',()=>{deps.closeAnalysisRegion();updateAnalysis();});
    profileChannel.addEventListener('change',()=>{syncControls();drawAnalysis();});
    position.addEventListener('input',()=>{get('analysisPositionValue').textContent=number(Number(position.value)/10)+'%';drawAnalysis();});
    differenceChannel.addEventListener('change',()=>{syncControls();drawAnalysis();});
    gain.addEventListener('change',()=>{syncControls();drawAnalysis();});
    channel.addEventListener('change', () => { matte.disabled = channel.value === 'alpha'; drawAnalysis(); });
    level.addEventListener('input', () => { get('analysisLevelValue').textContent = level.value; drawAnalysis(); });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(scheduleRedraw);
      // Wrapped controls and legends can resize a chart without resizing the panel.
      for (const element of [panel, ...cards.map(card => card.canvas), get('analysisCombinedChart')]) observer.observe(element);
    } else window.addEventListener('resize', scheduleRedraw);
    updateAnalysis();
  }

  return { attachAnalysisEvents, updateAnalysis, updateAnalysisViewport, pauseAnalysisForResize, resumeAnalysisAfterResize, getAnalysisSnapshot, redrawAnalysis:drawAnalysis,
    expandAnalysis:() => setExpanded(true), collapseAnalysis:() => setExpanded(false) };
}
