import { largestIcoPng } from '../core/ico.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createDecode({}, deps) {
  async function decodeSourceFile(file) {
    const decoded = await deps.decodeImageBlobOrOptional(file);
    try {
      if(decoded.width*decoded.height>40000000) throw new Error("Изображение больше 40 мегапикселей. Уменьшите исходник перед добавлением, чтобы ограничить расход памяти.");
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (decoded.imageData) ctx.putImageData(decoded.imageData, 0, 0);
      else ctx.drawImage(decoded.image, 0, 0);
      const imageData = decoded.imageData || ctx.getImageData(0, 0, canvas.width, canvas.height);
      const metadata = await deps.readPanoramaMetadata(file);
      return { ...metadata, file, name: file.name || "image", size: file.size || 0, type: file.type || "unknown",
        width: canvas.width, height: canvas.height, canvas, ctx, imageData,
        hasAlpha: deps.detectAlpha(imageData.data) };
    } finally { if (decoded.close) decoded.close(); }
  }
  
  async function decodeImageBlobOrOptional(file) {
    const kind = deps.fileKind(file);
    if (kind === 'jxl' || kind === 'avif') {
      const codec = await deps.loadOptionalCodec(kind === 'avif' ? 'heic' : 'modern');
      return codec.decode(file, kind);
    }
    if (kind === 'ico' && file.size <= 256 * 1024 * 1024) {
      const png = largestIcoPng(await file.arrayBuffer());
      if (png) return deps.decodeImageBlob(new Blob([png], { type: 'image/png' }));
    }
    try {
      return await deps.decodeImageBlob(file);
    } catch (error) {
      const kind = deps.fileKind(file);
      if (kind === "tiff") return deps.decodeTiffFile(file);
      if (kind === "heic") return deps.decodeHeicFile(file);
      if (kind === 'webp') return (await deps.loadOptionalCodec('modern')).decode(file, 'webp');
      throw error;
    }
  }
  
  function fileKind(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (/\.(tif|tiff)$/.test(name) || type === "image/tiff") return "tiff";
    if (/\.(heic|heif)$/.test(name) || type === "image/heic" || type === "image/heif") return "heic";
    for (const [extension, mime] of [['avif', 'image/avif'], ['jxl', 'image/jxl'], ['webp', 'image/webp'], ['ico', 'image/x-icon']]) {
      if (name.endsWith('.' + extension) || type === mime || (extension === 'ico' && type === 'image/vnd.microsoft.icon')) return extension;
    }
    return "";
  }
  
  async function decodeTiffFile(file) {
    deps.showStatus("Открываю TIFF через UTIF / libjpeg-turbo…");
    const codec = await deps.loadOptionalCodec("utif");
    return codec.decode(file);
  }
  
  async function decodeHeicFile(file) {
    deps.showStatus("Открываю HEIC/HEIF через libheif…");
    const codec = await deps.loadOptionalCodec("heic");
    return codec.decode(file);
  }
  
  async function decodeImageBlob(blob) {
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        return {
          image: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close && bitmap.close()
        };
      } catch (error) {
        // Fallback below.
      }
    }
  
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          close: null
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image decode failed"));
      };
      img.src = url;
    });
  }
  
  async function imageDataToPreview(imageData) {
    return {
      bitmap: await createImageBitmap(imageData),
      imageData
    };
  }
  
  async function decodeVariantForPreview(blob) {
    // A preview is valid only if the actual output file can be decoded.
    const decoded = await deps.decodeImageBlobOrOptional(blob);
    try {
      if (decoded.imageData) return await deps.imageDataToPreview(decoded.imageData);
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(decoded.image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { bitmap: await createImageBitmap(imageData), imageData };
    } finally { if (decoded.close) decoded.close(); }
  }

  return { decodeSourceFile, decodeImageBlobOrOptional, fileKind, decodeTiffFile, decodeHeicFile, decodeImageBlob, imageDataToPreview, decodeVariantForPreview };
}
