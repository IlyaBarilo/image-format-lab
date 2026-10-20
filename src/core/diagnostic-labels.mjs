export const DIAGNOSTIC_LABELS = Object.freeze({
  metrics: 'Формула PSNR и число изменённых отсчётов', crop: 'Точное вырезание области', resize: 'Уменьшение Canvas',
  'alpha-canvas': 'Прозрачность при чтении Canvas', 'icc-p3': 'ICC P3 → sRGB', 'photo-webp': 'Чтение встроенного фото: браузер / libwebp',
  'canvas-meta': 'Цветовой API браузера и рабочий sRGB', 'canvas-copy': 'Точная копия непрозрачных пикселей через Canvas',
  'alpha-white': 'Округление прозрачности на белой подложке', 'alpha-jpeg': 'Белая подложка → JPEG: прямой путь и приложение',
  'photo-png': 'ЛР1 · полный PNG8, Paeth 6', 'photo-bmp': 'ЛР1 · BMP24', 'photo-j85': 'ЛР1 · JPEG85, 4:2:0',
  'photo-a85': 'ЛР1 · AVIF85, скорость 6', 'photo-j30': 'ЛР2 · JPEG30', 'photo-j60': 'ЛР2 · JPEG60', 'photo-j90': 'ЛР2 · JPEG90',
  'photo-a73': 'ЛР2 · AVIF73, скорость 6', palette32: 'ЛР1 · PNG, палитра 32', dither32: 'ЛР1 · PNG, палитра 32 с дизерингом',
  sample16: 'ЛР1 · точный PNG16 и гистограмма', 'sample-float': 'ЛР1 · TIFF float32, значения вне 0–1',
  errors: 'ЛР2 · MAE, RMSE, карта ошибок, SSIM, профиль', scopes: 'ЛР1–2 · RGB / Y′CbCr, Waveform, Parade, вектроскоп и линия',
  'sample-alpha': 'ЛР3 · прозрачность, границы и профиль', 'print-tiff': 'ЛР3 · TIFF CMYK, TAC и только K',
  'print-jpeg': 'ЛР3 · JPEG CMYK90, TAC и только K', 'metric-worker': 'PSNR в Worker и числа таблицы отчёта'
});
export const DIAGNOSTIC_FIELDS = Object.freeze({
  b: 'Размер файла, байт', bytes: 'Размер файла, байт', P: 'PSNR RGB, дБ', psnr: 'PSNR RGB, дБ', a: 'Ошибка alpha, %', alpha: 'Ошибка alpha / TAC, %',
  changed: 'Изменённых отсчётов', n: 'Изменённых пикселей', max: 'Максимальная ошибка, %',
  fileHash: 'Отпечаток файла', pixelHash: 'Отпечаток декодированных пикселей / анализа', inputHash: 'Отпечаток входных пикселей', colors: 'Цветовые метки исходника и результата',
  levels: 'Занятые уровни R/G/B в области', top: 'Верхний уровень гистограммы', low: 'Нижние значения / прозрачные пиксели', high: 'Верхние значения / непрозрачные пиксели',
  MAE: 'Средняя абсолютная ошибка, %', RMSE: 'Среднеквадратичная ошибка RGB, %', mean: 'Среднее карты ошибок, уровни 0–255', peak: 'Максимум карты ошибок, уровни 0–255',
  line: 'Среднее по линии', SSIM: 'SSIM', pixels: 'Пикселей в кадре', strip: 'Пикселей в полосе', Y: 'Среднее Y′', waveY: 'Среднее Y′ полосы',
  edge: 'Граничные пиксели alpha', TAC: 'Максимальная сумма красок, %', over: 'Превышение 280 / 300 / 320%, пикселей',
  lostK: 'Утраченных пикселей только K', delta: 'Разность PSNR основного потока и Worker', bpp: 'Бит файла на пиксель', display: 'PSNR в таблице, дБ',
  hHist16: 'Счётчики и шкала гистограммы 16 бит', hErrors: 'Данные гистограммы ошибок', hMap: 'Данные карты различий', hSSIM: 'Данные карты SSIM', hErrorLine: 'Данные профиля ошибок',
  hRGB: 'Данные гистограммы RGB', hYC: 'Данные гистограммы Y′CbCr', hWave: 'Данные Waveform / Parade', hVector: 'Данные вектроскопа', hCIE: 'Данные CIE xy', hLine: 'Данные профиля по линии',
  hAlpha: 'Данные alpha-гистограммы, карты, границ и линии', hCMYK: 'Данные карт и счётчиков CMYK'
});
export function diagnosticFieldLabel(test, key) {
  if (test.id === 'sample-float' && (key === 'low' || key === 'high')) return key === 'low' ? 'Отсчётов R ниже 0' : 'Отсчётов R выше 1';
  if (test.id === 'sample-alpha' && (key === 'low' || key === 'high')) return key === 'low' ? 'Полностью прозрачных пикселей' : 'Полностью непрозрачных пикселей';
  if (test.id === 'errors' && key === 'line') return 'Средний максимум ошибок RGB по линии, %';
  if (test.id === 'sample-alpha' && key === 'line') return 'Средняя alpha по линии y=120, уровни 0–255';
  if (test.id.startsWith('print-') && key === 'MAE') return 'MAE C/M/Y/K, %';
  return DIAGNOSTIC_FIELDS[key] ?? key;
}
export function diagnosticErrorDescription(code) {
  const kind = String(code).split(':')[0];
  return ({ cancel: 'Проверка остановлена.', timeout: 'Проверка не завершилась за отведённое время.', unsupported: 'Нужная операция или возможность недоступна.',
    memory: 'Не удалось выделить память.', limit: 'Превышен допустимый размер.', color: 'Ошибка обработки цвета или профиля.', codec: 'Ошибка запуска или работы кодека.',
    'reference-missing': 'Для проверки отсутствует контрольный результат.', 'not-run': 'Проверка ещё не выполнялась или не запустилась после сбоя.', error: 'Операция завершилась ошибкой; её обезличенный код сохранён в отчёте.' })[kind] ?? 'Ошибка проверки; код сохранён в отчёте.';
}

export function diagnosticPhaseLabel(phase) {
  return ({ initialize: 'подготовка проверок', snapshot: 'снимок состояния', load: 'загрузка кодека', encode: 'кодирование',
    decode: 'декодирование', metrics: 'расчёт метрик', hash: 'расчёт отпечатка', canvas: 'подготовка пикселей Canvas',
    test: 'выполнение проверки', cleanup: 'завершение runtime', pack: 'упаковка отчёта', report: 'формирование отчёта',
    display: 'вывод отчёта', clipboard: 'копирование', form: 'открытие формы' })[phase] ?? 'выполнение проверки';
}
