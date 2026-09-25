// Own image scopes UI, MIT. These are established analysis methods.
import { differenceColor } from '../core/difference.mjs';
import { histogramView, histogramScale, histogramBinAt, histogramTick, histogramInterval, histogramSummary } from '../core/histogram-view.mjs';
import { analysisMaximum, spatialChannels, SIGNAL_NAMES } from '../core/analysis-output.mjs';
import { pixelBufferFromImageData } from '../core/pixels.mjs';
import { profileBinAt } from '../core/line-profile.mjs';
import { errorBinInterval, errorHistogramSummary } from '../core/error-histogram.mjs';
const CHANNELS = { rgb: [0, 1, 2], r: [0], g: [1], b: [2], alpha: [3], y: [4] };
const NAMES = ['R', 'G', 'B', 'α', 'Y′', 'Cb', 'Cr'];
const COLORS = ['#fb7185', '#4ade80', '#60a5fa', '#e2e8f0', '#facc15', '#22d3ee', '#f472b6'];
const SIGNAL_COLORS = ['#facc15', '#22d3ee', '#f472b6'];
const spatialName = index => index===3?'Y′':index===4?'Cb':index===5?'Cr':NAMES[index];
const spatialColor = index => index>=3?COLORS[index+1]:COLORS[index];
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
  let lastRegionKey = '', lastGuideKey = '';
  let viewportRegions = [], viewportKey = '', viewportTimer = null;
  let resizePaused = false, resizeNeedsUpdate = false;
  const followsViewport = () => deps.getAnalysisScope() === 'viewport' && type.value !== 'tradeoff';
  const readViewports = () => cards.slice(0, app.layout).map((_, side) => deps.getAnalysisViewport(side));

  function syncControls() {
    deps.syncAnalysisOutput();
    const tradeoff=type.value==='tradeoff',output=deps.getAnalysisOutputSettings();
    get('analysisScope').hidden=tradeoff;
    get('analysisMatteField').hidden=tradeoff;
    const difference = type.value === 'difference', errorHistogram = type.value === 'errorHistogram', spatial = spatialChannels(type.value).length>0, signalHistogram=type.value==='signalHistogram';
    const profile = type.value === 'profile', errorProfile=type.value==='errorProfile', vector = type.value === 'vectorscope';
    get('analysisChannelField').hidden = type.value !== 'histogram';
    get('analysisLevelField').hidden = type.value !== 'histogram' && !signalHistogram && !errorHistogram;
    get('analysisLevelLabel').textContent = errorHistogram ? 'Ошибка' : 'Уровень';
    get('analysisProfileField').hidden = !profile;
    get('analysisPositionField').hidden = !profile && !errorProfile;
    get('analysisLineOpen').hidden = !profile && !errorProfile;
    get('analysisDifferenceField').hidden = !difference && !errorHistogram && !errorProfile;
    get('analysisGainField').hidden = !difference;
    get('analysisDifferenceLegend').hidden = !difference;
    get('analysisDifferenceLimit').textContent = `≥ ${number(255/Number(gain.value))}`;
    matte.disabled = profile ? profileChannel.value === 'alpha' : vector || signalHistogram ? false : difference || errorHistogram || errorProfile ? differenceChannel.value === 'alpha' : !spatial && channel.value === 'alpha';
    panel.dataset.type = type.value;
    help.title = spatial
      ? 'По горизонтали — положение в кадре, по вертикали — уровень 0–255. Чем светлее след, тем больше пикселей. Нажмите для подробностей.'
      : 'По горизонтали — уровни или интервалы подписанной шкалы, по вертикали — доля пикселей. Шкала общая. Нажмите для подробностей.';
    get('analysisMethod').textContent = spatial
      ? 'Графики 1–4 следуют ячейкам сравнения. По горизонтали — положение слева направо (0–100% ширины кадра); в RGB Parade оно повторяется для R, G и B. По вертикали — кодовые уровни 0–255. Waveform: Y′ = round(0,2126 R + 0,7152 G + 0,0722 B), коэффициенты BT.709 применены к RGB8 после смешивания с выбранной подложкой. Это оценка сигнала, не линейная физическая яркость, HDR или IRE. Все пиксели учитываются; соседние столбцы объединяются максимум в 256 групп, уровни не усредняются. Плотность — доля пикселей группы на данном уровне. Яркость следа пропорциональна корню четвёртой степени из плотности относительно общего максимума всех видимых графиков и каналов. Фон и масштаб просмотра на расчёт не влияют.'
      : 'Графики 1–4 автоматически показывают результаты соответствующих ячеек сравнения с их форматами и настройками. По горизонтали — уровни целых отсчётов или явные интервалы float32, по вертикали — доля пикселей канала в процентах. Считаются все пиксели выбранной области. Целые уровни сохраняются точно; RGB после подложки округляется в исходной разрядности. При узком графике соседние уровни суммируются в общие группы, подписанные в сведениях. Для разных целых разрядностей используется общая нормированная шкала 0–1. Вне диапазона float32 отсчёты учитываются отдельно; крайние интервалы ими не заполняются. JSON сохраняет исходные счётчики и шкалу; PNG группирует их под размер отчёта. RGB учитывает выбранную подложку, α измеряется отдельно. Фон и масштаб просмотра не влияют на анализ.';
    if(signalHistogram)get('analysisMethod').textContent='Гистограмма Y′CbCr вычислена из декодированного RGB8 после смешивания с выбранной подложкой. Y′ = 0,2126 R + 0,7152 G + 0,0722 B; Cb = (B−Y′)/1,8556 + 128; Cr = (R−Y′)/1,5748 + 128. Значения округляются в шкалу 0–255. Нейтральная цветность находится около уровня 128. Это вычисленные сигналы BT.709, а не внутренние плоскости кодека, вещательные уровни или HDR. Учитываются все пиксели выбранной области; по вертикали — доля пикселей канала в процентах.';
    if(type.value==='ycbcrParade')get('analysisMethod').textContent='Y′CbCr Parade показывает вычисленные каналы декодированного RGB8: Y′ = 0,2126 R + 0,7152 G + 0,0722 B; Cb = (B−Y′)/1,8556 + 128; Cr = (R−Y′)/1,5748 + 128. После смешивания с выбранной подложкой значения округляются в шкалу 0–255, нейтральная цветность около 128. Три панели имеют общую горизонталь 0–100% выбранной области. Это не внутренние плоскости кодека, вещательные уровни или HDR.';
    if(type.value==='rgbWaveform')get('analysisMethod').textContent='Waveform RGB вместе накладывает вычисленные следы R, G и B декодированного RGB8 на одну общую координатную сетку: горизонталь 0–100% выбранной области, вертикаль 0–255. Прозрачность смешивается с выбранной подложкой. Плотность каждого канала нормируется на общий максимум; пересечения цветов складываются. Это видимые кодовые значения после декодирования, не внутренние плоскости кодека и не HDR.';
     if(difference) {
      help.title = 'Отличие каждой ячейки от исходного файла. Чёрный — совпадение, цвет — величина ошибки. Усиление общее. Нажмите для подробностей.';
      get('analysisMethod').textContent = 'Каждая ячейка сравнивается с исходным файлом, включая первую. RGB: максимум абсолютных разностей R/G/B после округления композиции с общей подложкой; α: абсолютная разность прозрачности без подложки. Это различия кодовых значений RGBA8, не Delta E и не оценка восприятия. Чёрный означает нулевую разность, цвет показывает величину от 0 до 255. Общее усиление умножает только отображаемую разность; красный — достижение или превышение верхнего порога шкалы. Средние/максимумы считаются по всем выбранным пикселям без усиления. Карта ограничена 512 пикселями по длинной стороне; каждая её точка хранит максимальную ошибку группы, чтобы не терять единичные отличия. Размеры результата и исходника должны совпадать: масштабирования или выравнивания по содержимому нет.';
     }
    if(errorHistogram){
      help.title='Попиксельная ошибка каждой ячейки относительно исходника. Нулевая группа означает точное совпадение. Нажмите для методики.';
      get('analysisMethod').textContent='Каждая ячейка сопоставляется с исходником в тех же координатах без масштабирования. Нужны одинаковые размеры; разные известные цветовые пространства не смешиваются. RGB: для каждого пикселя берётся максимум абсолютных разностей R/G/B после композиции с выбранной подложкой и округления в разрядности соответствующего растра; α: абсолютная разность прозрачности без подложки. Сравниваются нормированные кодовые значения точных RGBA8/16 отсчётов; при неизвестной цветовой метке преобразование цвета не предполагается. Группа 0 содержит только точные совпадения. Положительные ошибки распределяются по 255 интервалам (предыдущая граница, текущая граница] на шкале 0–100%; младшие биты учитываются до группировки. По вертикали — доля пикселей области в процентах. MAE RGB — среднее абсолютной ошибки по трём каналам и всем пикселям; RMSE RGB — корень из среднего квадрата ошибки по этим каналам. Для α MAE/RMSE считаются отдельно. Это не среднее максимума RGB на карте различий, не Delta E и не оценка восприятия.';
    }
    if(vector){
      help.title='Центр — нейтральные цвета. Направление и удаление показывают цветность. Плотность и шкалы общие для всех ячеек. Нажмите для подробностей.';
      get('analysisMethod').textContent='Вектороскоп учитывает все пиксели выбранной области RGB8 после композиции с общей подложкой. Y = 0,2126 R + 0,7152 G + 0,0722 B; Cb = (B−Y)/(1,8556×255), Cr = (R−Y)/(1,5748×255), коэффициенты BT.709. Cb растёт вправо, Cr вверх, обе оси от −0,5 до 0,5. Нейтральные значения в центре. Ориентиры R/M/B/C/G/Y соответствуют RGB-цветам с каналами 0/255; окружности — радиусы 0,25 и 0,5, не проценты насыщенности HSV или границы допустимого видео. Плотность считается в сетке 257×257, нормируется на число пикселей области; яркость следа — корень четвёртой степени плотности относительно общего максимума всех ячеек. Это анализ декодированных кодовых значений, не HDR, Delta E, проверка ICC или вещательных уровней.';
    }
    if(profile){
      help.title='Профиль значений вдоль общей линии A→B. Уровни 0–255; положение и каналы общие. Линию можно выбрать на миниатюре. Нажмите для подробностей.';
      get('analysisMethod').textContent='Профиль показывает ближайшие пиксели дискретной линии A→B внутри выбранной области. Шаг — один пиксель по её более длинной проекции, оба конца включены. По горизонтали положение от A (0%) до B (100%), по вертикали кодовые уровни 0–255. RGB смешивается с выбранной подложкой, α измеряется отдельно; Y′ = round(0,2126 R + 0,7152 G + 0,0722 B). До 1024 групп: линия графика показывает среднее группы, вертикальные отрезки — её минимум/максимум, чтобы сохранить узкие пики длинной линии. Указатель выбирает группу ближайшего пикселя. Одна точка или растр 1×1 дают один отсчёт. При разных размерах относительная линия одинакова, число отсчётов и координаты отличаются. «Линия…» редактирует черновик; применение обновляет все профили, отмена отбрасывает изменения. Это кодовые значения, не линейная физическая яркость.';
    }
    if(errorProfile){
      help.title='Абсолютная ошибка каждого пикселя линии A→B относительно исходника. По вертикали — процент полного диапазона; нажмите для методики.';
      get('analysisMethod').textContent='Профиль ошибки сравнивает каждый пиксель результата с исходником в тех же координатах линии A→B до объединения в группы. Нужны одинаковые размеры; разные известные цветовые пространства не смешиваются. RGB — максимум абсолютных разностей R/G/B после смешивания с выбранной подложкой и округления в разрядности каждого растра; α измеряется отдельно без подложки. Ошибки нормируются на полный диапазон каждой разрядности и показываются в процентах 0–100%. Точные RGBA8/16 отсчёты учитываются до группировки, в том числе младший бит RGBA16. До 1024 групп: линия показывает среднее, вертикальные отрезки — минимум и максимум ошибок группы. Указатель выбирает группу ближайшего пикселя. Это не «Разница» готовых профилей двух ячеек: встречные отклонения не гасят друг друга. Линия и выбранная область общие для ячеек; при неизвестной цветовой метке сравниваются кодовые значения без преобразования цвета.';
    }
    get('analysisMethod').textContent += ' Пункт «Заданная область» в списке области анализа открывает редактор общего прямоугольника в долях кадра для всех графиков. Повторный выбор этого пункта открывает сохранённую область для правки. Пограничные пиксели включаются целиком. Горизонталь Waveform/Parade 0–100% относится к выбранной области. При смене файла ручная область сбрасывается; обычные сохраняемые изображения и основные метрики не кадрируются. Кнопка «Создать исходник» добавляет отдельный PNG из применённой области для нового опыта.';
     if(output.display==='overlay')get('analysisMethod').textContent+=' Наложение сравнивает выбранную пару ячеек. Для гистограмм и профиля первый график — приглушённая пастельная заливка до нуля с тонкой границей, второй — насыщенный сплошной контур поверх неё с тёмной окантовкой. Цвета соответствуют выбранным каналам; числа ячеек и роли подписаны в легенде. У профиля сохранены отрезки минимума/максимума групп; один отсчёт показан заполненной точкой и кольцом. Для Waveform яркости, Parade и вектороскопа первый след голубой, второй оранжевый; для совместного RGB Waveform каналы сохраняют свои цвета, первый след приглушён, второй ярче. Нормировка общая для выбранной пары. Изменение пары/вида не запускает кодирование или Worker.';
    if(output.display==='delta'){
      help.title='Разница графиков: вторая выбранная ячейка минус первая. Ноль означает совпадение графиков. Нажмите для методики и единиц.';
      get('analysisMethod').textContent='«Разница» вычитает график первой выбранной ячейки из второй; порядок подписан, например Δ 2 − 1. Используются уже рассчитанные графики текущих результатов и выбранной области. Плюс означает увеличение во второй ячейке, минус — уменьшение. RGB учитывает подложку анализа, α измеряется отдельно. ' + (spatial
         ? 'Waveform и Parade сохраняют горизонталь 0–100% ширины области и вертикаль кодовых уровней 0–255. Вычитаются доли пикселей на каждом уровне каждой группы столбцов, в процентных пунктах. При разном числе групп плотности сначала нормируются на размер своей группы, затем приводятся к общей относительной сетке с весами пересечения групп. Оранжевый — прибавление, голубой — уменьшение, тёмный фон — ноль. Интенсивность — корень четвёртой степени модуля разности относительно общего максимума выбранных каналов; предел подписан в легенде. При уменьшении Canvas сохраняется значение с наибольшим модулем в экранной точке, чтобы не погасить противоположные отличия усреднением.'
        : profile
          ? 'Профиль вычитает средние групп вдоль относительной линии A→B. При разном числе групп используется линейная интерполяция кривых в общих позициях; единственный отсчёт постоянен. По вертикали — разность кодовых уровней, шкала симметрична относительно нуля. Минимумы/максимумы групп не вычитаются: такой интервал не был бы диапазоном попиксельных ошибок. Указатель показывает разницу в текущей относительной позиции.'
          : 'Гистограмма вычитает доли пикселей на согласованной шкале уровней или интервалов. Соседние уровни суммируются под ширину графика; разницы внутри одной группы могут взаимно погаситься, точные массивы остаются в JSON. Вне диапазона float32 разницы учитываются отдельно. По вертикали — процентные пункты, например 12% − 10% = +2 п.п. Разное число пикселей само по себе не создаёт разницу. Шкала симметрична относительно нуля и общая для выбранных каналов; указатель показывает разницу на выбранном уровне.') + ' Сопоставление выполняется в координатах графиков, без выравнивания содержимого изображений. Режим не запускает новое кодирование или Worker. В JSON сохранены оба графика и подписанные массивы разницы; PNG содержит график, единицы и порядок вычитания.';
    }
     if(tradeoff){
      help.title='Точки текущих ячеек: размер по горизонтали, выбранная метрика по вертикали. Данные уже готовых результатов; нажмите для методики.';
      get('analysisMethod').textContent='Точки соответствуют текущим готовым ячейкам, номера совпадают. По горизонтали размер файла в КБ (1000 байт), по вертикали выбранная метрика: PSNR RGB на белой подложке (выше — меньше ошибка), средняя абсолютная ошибка alpha в процентах от полного диапазона канала (ниже — лучше) или время обработки в мс, включая ожидание, декодирование и метрики. Это не изолированная скорость кодировщика. PSNR ∞ означает совпадение видимого RGB и показан в отдельной полосе, без подмены конечным числом. Одинаковые точки не сдвигаются, разнесены только номера; все значения есть в легенде. Точки не соединяются: перебора качества и интерполяции нет. Метрики взяты из основного сравнения всего изображения с декодированным исходником, область/линия/подложка панели на них не влияют. При несовпадении размеров PSNR/ошибка alpha недоступны. Устаревшие, ошибочные или отсутствующие метрики не получают точек.';
     }
     if(output.display==='delta'&&['signalHistogram','ycbcrParade'].includes(type.value))get('analysisMethod').textContent+=' Цветовые сигналы вычислены из декодированного RGB8 после выбранной подложки по BT.709: Y′ = 0,2126 R + 0,7152 G + 0,0722 B; Cb = (B−Y′)/1,8556 + 128; Cr = (R−Y′)/1,5748 + 128, затем округление до 0–255. Это не внутренние плоскости кодека и не вещательные уровни.';
    get('analysisCaveat').textContent=tradeoff?'Числа не заменяют визуальную оценку; время зависит от устройства и нагрузки. Подробности по текущим ячейкам:':errorHistogram?'Здесь считаются ошибки одних и тех же координат, поэтому размеры кадров должны совпадать. Подробности по текущим ячейкам:':'Одинаковые графики не гарантируют совпадения изображений. При разных размерах сравниваются распределения выбранной области без выравнивания, а не только потери кодека. Подробности по текущим ячейкам:';
    if (followsViewport()) {
      get('analysisMethod').textContent = get('analysisMethod').textContent
        .replace('Фон и масштаб просмотра на расчёт не влияют.', '')
        .replace('Фон и масштаб просмотра не влияют на анализ.', '')
        .replace('Считаются все пиксели кадра RGBA 8 бит.', 'Считаются пиксели видимой части RGBA 8 бит.');
      get('analysisMethod').textContent += ' Режим «Видимая часть» берёт фактический фрагмент каждой ячейки с учётом масштаба и перемещения. Пиксели на границе включаются целиком, фон вне изображения исключён. При разных размерах окон/результатов области могут различаться; их точные координаты записаны в данных графиков. В максимуме используются последние размеры окон просмотра. Линия A→B задаётся относительно видимой области каждой ячейки; её редактор показывает исходник в окне первой ячейки. Основные метрики и сохраняемые изображения остаются полными.';
    }
    const high=app.source?.pixelBuffer?.bitDepth>8||app.variants.slice(0,app.layout).some(v=>v.pixelBuffer?.bitDepth>8);
    const precision=high?(type.value==='histogram'||errorHistogram||errorProfile||tradeoff?'Расчёт по точным пикселям каждой ячейки; показ изображения — 8 бит/канал.':'Этот график рассчитан по 8-битному предпросмотру; младшие биты исходника здесь не учитываются.'):'';
    const notice=get('analysisPrecision');if(notice){notice.hidden=!precision;notice.textContent=precision;}
    if(precision)get('analysisMethod').textContent+=' '+precision;
    if(high&&app.source?.pixelBuffer?.colorSpace==='unknown')get('analysisMethod').textContent+=' Цветовое описание исходника неизвестно: сравниваются кодовые значения без цветового преобразования; экранный показ использует приближение sRGB.';
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
    const depth=variant?.pixelBuffer?.bitDepth;
    const precision=depth&&(depth>8||app.source?.pixelBuffer?.bitDepth>8)?` · ${depth} бит/канал`:'';
    const label = `${side + 1} · ${c ? deps.outputFormatLabel(c.format) : 'Нет результата'}${quality}${precision}`;
    if (!app.source) return { label, message: 'Добавьте изображение для анализа.' };
    if (app.sourceLoading) return { label, message: 'Исходник открывается…' };
    if (!variant || side >= app.layout) return { label, message: 'Вариант скрыт.' };
    if (variant.error) return { label, message: `Ошибка результата: ${variant.error}` };
    if (!deps.isVariantReady(variant)) return { label, message: variant.processing ? 'Результат пересчитывается…' : 'Параметры изменены. Ожидание пересчёта…' };
    if(['difference','errorHistogram','errorProfile'].includes(type.value) && (variant.imageData.width !== app.source.width || variant.imageData.height !== app.source.height))
      return {label,message:`${type.value==='difference'?'Карта':type.value==='errorProfile'?'Профиль ошибки':'Гистограмма ошибок'} требует одинаковых размеров: ${variant.imageData.width}×${variant.imageData.height}, исходник ${app.source.width}×${app.source.height}.`};
    const viewport = followsViewport() ? viewportRegions[side] : null;
    if (followsViewport() && !viewport?.region) return { label, message: viewport?.message || 'Определяю видимую часть…' };
    return { label, imageData: variant.imageData, pixelBuffer: variant.pixelBuffer, histogramOptions: variant.histogramOptions ? { ...variant.histogramOptions, ...(variant.histogramOptions.range ? { range: [...variant.histogramOptions.range] } : {}) } : undefined, region:viewport?.region || deps.getAnalysisRegion(),config:{...variant.resultConfig},measurement:{...variant.measurement} };
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
    const guideKey=JSON.stringify([type.value,deps.getAnalysisScope(),deps.getAnalysisRegion(),deps.getAnalysisLine()]);
    if(guideKey!==lastGuideKey){lastGuideKey=guideKey;deps.redrawPreviews?.();}
    clearPlots();
    deps.presentAnalysis(getAnalysisSnapshot());
    queued = false;
    if (body.hidden) return;
    cards.forEach((card, side) => {
      if (card.element.hidden) return;
      const input = selected(side);
      card.info.textContent = input.message || (['profile','errorProfile'].includes(type.value)?'Считаю пиксели линии…':followsViewport()?'Считаю видимую часть…':'Считаю все пиксели…');
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

  async function compute(input, background, kind, reference, line) {
    const { imageData, pixelBuffer, histogramOptions, region } = input;
    const owner = ['histogram','errorHistogram','errorProfile'].includes(kind) ? pixelBuffer || imageData : imageData;
    const activeCache = cache;
    let entry = cache.get(owner);
    const key = `${kind}:${background}:${JSON.stringify(region)}:${kind === 'histogram' ? JSON.stringify(histogramOptions) : ''}`;
    if (entry?.has(key)) return entry.get(key);
    if (typeof Worker === 'undefined') throw new Error('Для анализа нужен браузер с поддержкой Worker.');
    // workerCompute clones the payload: the viewer retains ownership of its pixels.
    const result = await deps.workerCompute(kind, { ...(kind === 'histogram' ? { pixelBuffer: pixelBuffer || pixelBufferFromImageData(imageData), options: histogramOptions } : ['errorHistogram','errorProfile'].includes(kind) ? {pixelBuffer:pixelBuffer || pixelBufferFromImageData(imageData)} : { imageData }), matte: background, region, ...(['difference','errorHistogram','errorProfile'].includes(kind) ? {reference} : {}), ...(['profile','errorProfile'].includes(kind) ? {line} : {}) });
    entry ??= new Map();
    entry.set(key, result);
    if(cache === activeCache) cache.set(owner, entry);
    return result;
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queued && !body.hidden && !resizePaused) {
        queued = false;
        const token = generation, inputs = cards.slice(0, app.layout).map((_, side) => selected(side)), background = matte.value;
        const kind = ['parade','rgbWaveform','ycbcrParade'].includes(type.value) ? 'waveform' : type.value;
        const reference = ['errorHistogram','errorProfile'].includes(kind)?app.source?.pixelBuffer:app.source?.imageData, line=deps.getAnalysisLine();
        const computed = [];
        for (const input of inputs) {
          if (input.imageData) {
            try { computed.push({ ...input, data: kind==='tradeoff'?{width:input.imageData.width,height:input.imageData.height}:await compute(input, background, kind, reference, line) }); }
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
    const settings=kind==='tradeoff'?{type:kind,display:'metrics',metric:output.metric}:{type:kind,display:output.display,...(['overlay','delta'].includes(output.display)?{pair:output.pair}:{}),matte:matte.value,scope:deps.getAnalysisScope(),region:deps.getAnalysisRegion(),...(followsViewport()?{viewports:viewportRegions.map((v,i)=>({cell:i+1,...v}))}:{}),...(kind==='histogram'||kind==='signalHistogram'?{channel:kind==='signalHistogram'?'rgb':channel.value,level:Number(level.value)}:kind==='errorHistogram'?{errorChannel:differenceChannel.value,level:Number(level.value)}:kind==='profile'?{profileChannel:profileChannel.value,position:Number(position.value),line:deps.getAnalysisLine()}:kind==='errorProfile'?{errorChannel:differenceChannel.value,position:Number(position.value),line:deps.getAnalysisLine()}:kind==='difference'?{differenceChannel:differenceChannel.value,gain:Number(gain.value)}:{})};
    return {version:1,revision:generation,source:app.source?{name:app.source.name,width:app.source.width,height:app.source.height,bytes:app.source.size}:null,settings,method:get('analysisMethod').textContent,
      items:cards.slice(0,app.layout).map((_,i)=>{const current=selected(i),item=results[i];return {cell:i+1,label:current.label,status:current.imageData&&item?.data?'ready':'unavailable',message:current.message||item?.message||(!item?'Расчёт…':null),config:item?.data&&current.imageData?item.config:null,measurement:item?.data&&current.imageData?item.measurement:null,data:current.imageData?item?.data||null:null};})};
  }

  function drawIndividualAnalysis() {
    if (body.hidden || !results.length) return;
    if (type.value === 'difference') { drawDifference(); return; }
    if (type.value === 'errorHistogram') { drawErrorHistogram(); return; }
    if (type.value === 'errorProfile') { drawErrorProfile(); return; }
    if (type.value === 'vectorscope' || type.value === 'profile') { drawExtraScopes(); return; }
    if (type.value !== 'histogram' && type.value !== 'signalHistogram') { drawSpatial(); return; }
    const signal=type.value==='signalHistogram',selectedChannel=signal?'rgb':channel.value;
    const indices = CHANNELS[selectedChannel], bin = Number(level.value),names=signal?SIGNAL_NAMES:NAMES;
    const widths = cards.flatMap((card, side) => {
      if (card.element.hidden || !results[side]?.data) return [];
      card.canvas.hidden = false;
      return [Math.max(256, card.canvas.getBoundingClientRect().width - 72)];
    });
    let view;
    try { view = histogramView(results, selectedChannel, Math.min(...widths), { allowUnknownColorSpace: true }); }
    catch (error) {
      for (const card of cards) { card.canvas.hidden = true; card.info.hidden = false; card.info.textContent = error.message; card.element.dataset.state = 'unavailable'; card.values.textContent = ''; }
      details.textContent = error.message; return;
    }
    const maximum = analysisMaximum(type.value, view.items, selectedChannel);
    get('analysisLevelValue').textContent = view.scale ? histogramTick(view.scale, bin / 255) : String(bin);
    matte.disabled = !signal && channel.value === 'alpha';
    const detailLines = [];
    cards.forEach((card, side) => {
      if (card.element.hidden) return;
      const item = view.items[side], h = item?.data;
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
      const interval = histogramInterval(view.scale, bin);
      const description = `${rasterDescription(h)} · ${signal?'Y′CbCr из RGB8':channel.value === 'alpha' ? 'α без подложки' : 'RGB'} на ${h.matte === 'white' ? 'белом' : 'чёрном'} · ${histogramSummary(h, selectedChannel)}${view.scale.grouped ? ` Показано ${view.scale.bins} групп; доли суммируются.` : ''}`;
      card.badge.title = `${item.label}. ${description}`;
      card.canvas.hidden = false;
      card.canvas.dataset.yMax = String(maximum);
      card.canvas.dataset.kind = 'histogram';
      const values = indices.map(index => `${names[index]} ${number(h.channels[index][histogramBinAt(view.scale, bin)] / h.pixelCount * 100)}%`).join(' · ');
      const means = indices.map(index => {
        const mean = h.means?.[index] ?? h.channels[index].reduce((sum, count, value) => sum + count * value, 0) / h.pixelCount;
        return `${names[index]} ${number(mean)}`;
      }).join(' · ');
      card.values.textContent = values;
      card.values.title = `${interval}. Средние: ${means}.`;
      detailLines.push(`${item.label}: ${description}. Средние: ${means}.`);
      card.canvas.setAttribute('aria-label', `${item.label}. ${description}. Гистограмма ${indices.map(i => names[i]).join(', ')}. ${interval}: ${values}. Средние: ${means}.`);
      plot(card.canvas, h, indices, maximum, bin, undefined, signal);
    });
    details.textContent = detailLines.join('\n');
    updateSizeNote();
  }

  function updateSizeNote() {
    const sizes = [...new Set(results.filter(item => item.data).map(({ data: h }) => `${h.width}×${h.height}`))];
    status.textContent = sizes.length > 1
      ? `Размеры различаются: ${sizes.join(', ')}. ${['histogram','signalHistogram','vectorscope'].includes(type.value) ? 'Сравниваются распределения выбранной области кадра.' : type.value === 'profile' ? 'Линия задана относительно области; координаты пикселей и число отсчётов различаются.' : 'Горизонталь нормирована по ширине выбранной области каждого кадра.'}` : '';
  }

  function drawErrorHistogram() {
    const errorChannel=differenceChannel.value,bin=Number(level.value),index=errorChannel==='alpha'?1:0;
    const maximum=analysisMaximum('errorHistogram',results,errorChannel);
    get('analysisLevelValue').textContent=bin===0?'0%':`${number(bin/255*100)}%`;
    const lines=[];
    cards.forEach((card,side)=>{
      if(card.element.hidden)return;
      const item=results[side],data=item?.data;
      if(!data){card.element.dataset.state='unavailable';card.info.textContent=item?.message||'Нет результата.';card.info.hidden=false;card.canvas.hidden=true;card.values.textContent='';return;}
      card.element.dataset.state='ready';card.info.hidden=true;card.canvas.hidden=false;
      card.canvas.dataset.kind='errorHistogram';card.canvas.dataset.yMax=String(maximum);
      const interval=errorBinInterval(bin),part=number(data.channels[index][bin]/data.pixelCount*100);
      const description=`${data.width}×${data.height}, область ${data.bounds.x}, ${data.bounds.y}: ${data.bounds.width}×${data.bounds.height}; ${data.bitDepth.source}/${data.bitDepth.result} бит/канал; ${errorChannel==='alpha'?'α без подложки':`RGB на ${data.matte==='white'?'белом':'чёрном'}`}. ${errorHistogramSummary(data)}.${data.colorComparison==='unknown-code-values'?' Цветовое пространство неизвестно: сравниваются кодовые значения.':''}`;
      const label=`${item.label}. ${description} Ошибка ${interval}: ${part}% пикселей.`;
      card.badge.title=`${item.label}. ${description}`;
      card.values.textContent=`Ошибка ${interval}: ${part}% · ${errorChannel==='alpha'?`MAE α ${number(data.metrics.maeAlpha)}%, RMSE α ${number(data.metrics.rmseAlpha)}%`:`MAE RGB ${number(data.metrics.maeRGB)}%, RMSE RGB ${number(data.metrics.rmseRGB)}%`}`;
      card.values.title=description;card.canvas.setAttribute('aria-label',label);lines.push(label);
      plotErrorHistogram(card.canvas,data,errorChannel,maximum,bin);
    });
    details.textContent=lines.join('\n');status.textContent='';
  }

  function plotErrorHistogram(canvas,data,errorChannel,maximum,bin,outputSize) {
    const rect=outputSize||canvas.getBoundingClientRect(),width=rect.width,height=rect.height;
    const dpr=outputSize?1:Math.max(1,Math.min(2.5,devicePixelRatio||1));
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#101923';ctx.fillRect(0,0,width,height);
    const left=56,right=width-16,top=28,bottom=height-26,index=errorChannel==='alpha'?1:0;
    const values=data.channels[index],x=i=>left+(right-left)*i/255,y=n=>bottom-(bottom-top)*n/data.pixelCount*100/maximum;
    ctx.font='11px "Segoe UI", sans-serif';ctx.textBaseline='middle';
    for(const ratio of [0,.5,1]){const py=bottom-(bottom-top)*ratio;ctx.strokeStyle='#334155';ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();ctx.fillStyle='#cbd5e1';ctx.textAlign='right';ctx.fillText(`${number(maximum*ratio)}%`,left-5,py);}
    ctx.strokeStyle=errorChannel==='alpha'?'#e2e8f0':'#fb7185';ctx.lineWidth=1.5;ctx.beginPath();values.forEach((n,i)=>i?ctx.lineTo(x(i),y(n)):ctx.moveTo(x(i),y(n)));ctx.stroke();
    ctx.strokeStyle='#e2e8f0';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(bin),top);ctx.lineTo(x(bin),bottom);ctx.stroke();ctx.setLineDash([]);
    for(const mark of [0,64,128,192,255]){ctx.fillStyle='#cbd5e1';ctx.textAlign=mark===0?'left':mark===255?'right':'center';ctx.fillText(`${number(mark/255*100)}%`,x(mark),height-10);}
    ctx.fillStyle=errorChannel==='alpha'?'#e2e8f0':'#fb7185';ctx.textAlign='right';ctx.fillText(errorChannel==='alpha'?'α':'RGB',right,12);
    canvas.dataset.xMin='0';canvas.dataset.xMax='100';canvas.dataset.bins='256';canvas.dataset.yMax=String(maximum);
  }

  function drawErrorProfile() {
    const index=differenceChannel.value==='alpha'?1:0,cursor=Number(position.value);
    const maximum=analysisMaximum('errorProfile',results,differenceChannel.value),lines=[];
    get('analysisPositionValue').textContent=number(cursor/10)+'%';
    cards.forEach((card,side)=>{
      if(card.element.hidden)return;
      const item=results[side],data=item?.data;
      if(!data){card.element.dataset.state='unavailable';card.info.textContent=item?.message||'Нет результата.';card.info.hidden=false;card.canvas.hidden=true;card.values.textContent='';return;}
      card.element.dataset.state='ready';card.info.hidden=true;card.canvas.hidden=false;
      const bin=profileBinAt(data,cursor),channel=data.channels[index],points=data.points;
      const value=channel.mean[bin],low=channel.min[bin],high=channel.max[bin];
      const description=`${rasterDescription(data)} · линия A (${points.x0}, ${points.y0}) → B (${points.x1}, ${points.y1}), ${number(data.sampleCount)} пикселей, ${data.bins} групп · RGBA ${data.bitDepth.source}/${data.bitDepth.result} бит${data.colorComparison==='unknown-code-values'?' · цветовая метка неизвестна, сравнение кодовых значений':''}`;
      const label=`${item.label}. ${description}. ${index?'Ошибка α':'Ошибка RGB max'} в позиции ${number(cursor/10)}%: среднее ${number(value)}%, минимум ${number(low)}%, максимум ${number(high)}%.`;
      card.badge.title=`${item.label}. ${description}`;
      card.values.textContent=`${index?'Ошибка α':'Ошибка RGB max'} ${number(value)}%${data.counts[bin]>1?` [${number(low)}–${number(high)}%]`:''}`;
      card.values.title=`${data.counts[bin]} пикселей в группе; минимум и максимум абсолютной ошибки в процентах полного диапазона.`;
      card.canvas.setAttribute('aria-label',label);
      deps.plotErrorProfile(card.canvas,data,index,cursor,maximum);
      lines.push(label);
    });
    details.textContent=lines.join('\n');updateSizeNote();
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
      plotDifference(card.canvas,data,index,palette);
    });
    details.textContent=lines.join('\n');status.textContent='';
  }

  function plotDifference(canvas,data,index,palette,outputSize) {
    const rect=outputSize||canvas.getBoundingClientRect(), dpr=outputSize?1:Math.max(1,Math.min(2.5,devicePixelRatio||1));
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
  }

  function drawSpatial() {
    const indices = spatialChannels(type.value),overlap=type.value==='rgbWaveform';
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
         return `${spatialName(index)} ${low}–${high}, среднее ${number(sum / data.pixelCount)}`;
      }).join(' · ');
      const description = `${rasterDescription(data)} · ${data.columns} групп столбцов · RGB на ${data.matte === 'white' ? 'белом' : 'чёрном'}`;
      card.badge.title = `${item.label}. ${description}`;
       const label = `${item.label}. ${description}. ${type.selectedOptions[0].textContent}. Уровни 0–255, ширина кадра 0–100%. ${summary}.`;
      card.canvas.setAttribute('aria-label', label);
      detailLines.push(label);
       plotSpatial(card.canvas, data, indices, maximum, undefined, overlap);
    });
    details.textContent = detailLines.join('\n');
    updateSizeNote();
  }

   function plotSpatial(canvas, data, indices, maximum, outputSize, overlap=false) {
    const rect = outputSize || canvas.getBoundingClientRect(), width = rect.width, height = rect.height;
    const dpr = outputSize ? 1 : Math.max(1, Math.min(2.5, devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, width, height);
    const left = 36, top = 28, bottom = height - 25, right = width - 12, gap = 12;
     const planeWidth = overlap?right-left:(right - left - gap * (indices.length - 1)) / indices.length;
    ctx.font = '11px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const y = value => bottom - (bottom - top) * value / 255;
    for (const value of [0, 64, 128, 192, 255]) {
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'right'; ctx.fillText(String(value), left - 5, y(value));
    }
    indices.forEach((index, plane) => {
       const start = overlap?left:left + plane * (planeWidth + gap);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      for (const value of [0, 64, 128, 192, 255]) {
        ctx.beginPath(); ctx.moveTo(start, y(value)); ctx.lineTo(start + planeWidth, y(value)); ctx.stroke();
      }
      const raster = document.createElement('canvas'); raster.width = data.columns; raster.height = 256;
      const rasterCtx = raster.getContext('2d'), pixels = rasterCtx.createImageData(data.columns, 256);
       const color = index === 3 ? [226, 232, 240] : index === 4 ? [34, 211, 238] : index === 5 ? [244, 114, 182] : index === 0 ? [251, 113, 133] : index === 1 ? [74, 222, 128] : [96, 165, 250];
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
       if(overlap)ctx.globalCompositeOperation='lighter';
       ctx.drawImage(raster, start, top, planeWidth, bottom - top);
       ctx.globalCompositeOperation='source-over';
       ctx.textAlign = 'center'; ctx.fillStyle = spatialColor(index);
       ctx.fillText(spatialName(index), overlap?right-(2-plane)*24:start + planeWidth / 2, 12);
      ctx.fillStyle = '#cbd5e1';
       if(overlap&&plane>0)return;
       for (const ratio of indices.length === 1 || overlap ? [0, 0.5, 1] : [0, 1]) {
        ctx.textAlign = ratio === 0 ? 'left' : ratio === 1 ? 'right' : 'center';
        ctx.fillText(`${ratio * 100}%`, start + planeWidth * ratio, height - 10);
      }
    });
  }

   function plot(canvas, histogram, indices, maximum, bin, outputSize, signal=false) {
    const rect = outputSize || canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    const dpr = outputSize ? 1 : Math.max(1, Math.min(2.5, devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, width, height);
    const left = 56, top = 28, bottom = height - 25, right = width - 16;
    const scale = histogram.viewScale || histogramScale(histogram, indices[0] === 3 ? 'alpha' : 'rgb');
    const x = value => left + (right - left) * value;
    canvas.dataset.xMin = String(scale.min); canvas.dataset.xMax = String(scale.max); canvas.dataset.bins = String(scale.bins);
    canvas.dataset.yMax = String(maximum);
    const y = percent => bottom - (bottom - top) * percent / maximum;
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const ratio of [0, 0.5, 1]) {
      const py = y(maximum * ratio);
      ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'right';
      ctx.fillText(`${number(maximum * ratio)}%`, left - 5, py, left - 7);
    }
    for (const ratio of scale.max === 255 ? [0, 64/255, 128/255, 192/255, 1] : [0, .25, .5, .75, 1]) {
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'center'; ctx.fillText(histogramTick(scale, ratio), x(ratio), height - 10);
    }
    for (const index of indices) {
       ctx.strokeStyle = signal?SIGNAL_COLORS[index]:COLORS[index]; ctx.lineWidth = 1.3; ctx.beginPath();
      histogram.channels[index].forEach((count, value) => {
        const py = y(count / histogram.pixelCount * 100);
        const px = x(value / (scale.bins - 1));
        if (value === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(bin / 255), top); ctx.lineTo(x(bin / 255), bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    indices.slice().reverse().forEach((index, offset) => {
       ctx.fillStyle = signal?SIGNAL_COLORS[index]:COLORS[index]; ctx.fillText(signal?SIGNAL_NAMES[index]:NAMES[index], right - offset * (signal?28:20), 3);
    });
  }

  // Report drawing uses the same plots with explicit data and output dimensions.
  // It does not resize live canvases or recalculate the viewport/codec results.
  function renderAnalysisChart(canvas, item, settings, maximum, outputSize) {
    const data = item.data;
    if (settings.type === 'histogram' || settings.type === 'signalHistogram') {
      const prepared = data.viewScale ? data : histogramView([item], settings.channel, Math.max(256, (outputSize || canvas.getBoundingClientRect()).width - 72), { allowUnknownColorSpace: true }).items[0].data;
       plot(canvas, prepared, CHANNELS[settings.channel], data.viewScale ? maximum : Math.max(maximum || 0, analysisMaximum(settings.type, [{data:prepared}], settings.channel)), settings.level, outputSize, settings.type==='signalHistogram');
    }
    else if (spatialChannels(settings.type).length) plotSpatial(canvas, data, spatialChannels(settings.type), maximum, outputSize, settings.type==='rgbWaveform');
    else if (settings.type === 'vectorscope') deps.plotVectorscope(canvas, data, maximum, outputSize);
    else if (settings.type === 'profile') deps.plotLineProfile(canvas, data, CHANNELS[settings.profileChannel], settings.position, outputSize);
    else if (settings.type === 'errorProfile') deps.plotErrorProfile(canvas, data, settings.errorChannel==='alpha'?1:0, settings.position, maximum, outputSize);
    else if (settings.type === 'difference') plotDifference(canvas, data, settings.differenceChannel === 'alpha' ? 1 : 0, Array.from({length:256},(_,value)=>differenceColor(value,settings.gain)), outputSize);
    else if (settings.type === 'errorHistogram') plotErrorHistogram(canvas,data,settings.errorChannel,maximum,settings.level,outputSize);
    else throw new Error('Неизвестный вид графика отчёта.');
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

  return { attachAnalysisEvents, updateAnalysis, updateAnalysisViewport, pauseAnalysisForResize, resumeAnalysisAfterResize, getAnalysisSnapshot, renderAnalysisChart, redrawAnalysis:drawAnalysis,
    expandAnalysis:() => setExpanded(true), collapseAnalysis:() => setExpanded(false) };
}
