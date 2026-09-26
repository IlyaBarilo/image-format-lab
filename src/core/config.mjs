export const FORMAT_DEFS = {
  original: {
    label: "Исходный файл",
    mime: "",
    ext: "",
    lossy: false,
    alpha: "source",
    native: true
  },
  jpeg: {
    label: "JPEG",
    mime: "image/jpeg",
    ext: "jpg",
    lossy: true,
    alpha: "none",
    native: false,
    codec: "utif"
  },
  png: {
    label: "PNG",
    mime: "image/png",
    ext: "png",
    lossy: false,
    alpha: "full",
    native: true
  },
  pngIndexed: {
    label: "PNG · палитра",
    mime: "image/png",
    ext: "png",
    lossy: false,
    alpha: "binary",
    native: false
  },
  pngUpng: {
    label: "PNG opt",
    mime: "image/png",
    ext: "png",
    lossy: false,
    alpha: "full",
    native: false,
    codec: "upng"
  },
  webp: {
    label: "WebP",
    mime: "image/webp",
    ext: "webp",
    lossy: true,
    alpha: "full",
    native: true
  },
  avif: {
    label: "AVIF",
    mime: "image/avif",
    ext: "avif",
    lossy: true,
    alpha: "full",
    native: false,
    codec: "heic"
  },
  webpLossless: { label: "WebP lossless", mime: "image/webp", ext: "webp", lossy: false, alpha: "full", native: false, codec: "modern" },
  jxl: { label: "JPEG XL", mime: "image/jxl", ext: "jxl", lossy: true, alpha: "full", native: false, codec: "modern" },
  jxlLossless: { label: "JPEG XL lossless", mime: "image/jxl", ext: "jxl", lossy: false, alpha: "full", native: false, codec: "modern" },
  tiff: { label: "TIFF", mime: "image/tiff", ext: "tif", lossy: false, alpha: "full", native: false, codec: "utif" },
  ico: { label: "ICO · 7 размеров", mime: "image/x-icon", ext: "ico", lossy: false, alpha: "full", native: false },
  heic: {
    label: "HEIC",
    mime: "image/heic",
    ext: "heic",
    lossy: true,
    alpha: "full",
    native: false,
    codec: "heic"
  },
  gif: {
    label: "GIF static",
    mime: "image/gif",
    ext: "gif",
    lossy: false,
    alpha: "binary",
    native: false
  },
  gifenc: {
    label: "GIF gifenc",
    mime: "image/gif",
    ext: "gif",
    lossy: false,
    alpha: "binary",
    native: false,
    codec: "gifenc"
  },
  bmp8: {
    label: "BMP 8-bit",
    mime: "image/bmp",
    ext: "bmp",
    lossy: false,
    alpha: "none",
    native: false
  },
  bmp24: {
    label: "BMP 24-bit",
    mime: "image/bmp",
    ext: "bmp",
    lossy: false,
    alpha: "none",
    native: false
  },
  bmp32: {
    label: "BMP 32-bit",
    mime: "image/bmp",
    ext: "bmp",
    lossy: false,
    alpha: "full",
    native: false
  }
};

export const DEFAULT_VARIANTS = [
  { format: "original", quality: 100, gifColors: 256, gifDither: true, bmpColors: 256, bmpCompression: "none", matte: "white" },
  { format: "jpeg", quality: 85, gifColors: 256, gifDither: true, bmpColors: 256, bmpCompression: "none", matte: "white", jpegSubsampling: "420", jpegProgressive: false },
  { format: "png", quality: 100, gifColors: 256, gifDither: true, bmpColors: 256, bmpCompression: "none", matte: "white" },
  { format: "webp", quality: 85, gifColors: 128, gifDither: true, bmpColors: 256, bmpCompression: "none", matte: "white" }
].map(variant => ({ pngFilter: "default", pngLevel: 6, webpMethod: 4, jxlEffort: 5, avifSpeed: 6, ...variant }));

export const BATCH_STORAGE_KEY = "image-format-viewer.batch-settings.v1";

export const DEFAULT_EXPORT_CONFIG = { pngDepth: "auto", pngFilter: "default", pngLevel: 6, tiffCompression: "deflate", tiffLevel: 6, tiffPredictor: true, ...DEFAULT_VARIANTS[1], resizeWidth: "", resizeHeight: "", metadataPolicy: "panorama", delivery: "files", targetKB: "", minQuality: 40 };

export const BACKGROUNDS = {
  red: "#ef4444",
  green: "#22c55e",
  blue: "#3b82f6",
  black: "#000000",
  white: "#ffffff",
  gray: "#808080"
};

export const MATTES = {
  white: "#ffffff",
  black: "#000000",
  gray: "#808080",
  red: "#ef4444",
  green: "#22c55e",
  blue: "#3b82f6"
};

export const OPTIONAL_CODECS = {
  modern: { label: "WebP lossless / JPEG XL", version: "libwebp 1.6.0 / libjxl 0.12.0", kind: "worker" },
  upng: {
    label: "UPNG",
    version: "2.1.0 (pako 2.1.0)",
    kind: "script",
    deps: [
      "vendor/pako-2.1.0.min.js"
    ],
    urls: [
      "vendor/UPNG-2.1.0.js"
    ],
    ready: () => window.UPNG && window.pako ? window.UPNG : null
  },
  gifenc: {
    label: "gifenc",
    version: "1.0.3",
    kind: "script",
    urls: [
      "vendor/gifenc-1.0.3.browser.js"
    ],
    ready: () => window.gifenc && window.gifenc.GIFEncoder && window.gifenc.quantize && window.gifenc.applyPalette ? window.gifenc : null
  },
  utif: {
    label: "JPEG / BMP / TIFF · libjpeg-turbo / libnsbmp / libtiff / UTIF",
    version: "libnsbmp 0.1.7 / libtiff 4.7.2 / UTIF 3.1.0 / libjpeg-turbo 3.2.0",
    kind: "worker"
  },
  heic: {
    label: "HEIC / AVIF · libheif",
    version: "1.23.4 (libde265 1.1.2, Kvazaar 2.3.2, libaom 3.15.0)",
    kind: "worker"
  }
};

export const PROFILE_KEY = "image-format-viewer.comparison-profiles.v1";

export const EXPERIMENTS = {
  photo: { question: "Сравните детали и плавные переходы: какое качество даёт меньший файл без заметных артефактов?", formats: ["original", "jpeg", "webp", "png"] },
  alpha: { question: "Поменяйте фон на чёрный и белый. Где теряется прозрачность и как меняется Δα?", formats: ["original", "jpeg", "png", "gif"] },
  palette: { question: "Сравните GIF и PNG с одинаковой палитрой и дизерингом. Отличаются ли размер файла и цвета?", formats: ["original", "gif", "pngIndexed", "pngIndexed"] }
};
