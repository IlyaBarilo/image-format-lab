import { largestIcoPng } from '../core/ico.mjs';
import { pixelBufferByteLength, createPixelBuffer } from '../core/pixel-buffer.mjs';
import { pixelBufferFromImageData } from '../core/pixels.mjs';

function validateDecodedRaster(decoded) {
  if (decoded.pixelBuffer) {
    const pixels=createPixelBuffer(decoded.pixelBuffer);
    if(pixels.width!==decoded.width||pixels.height!==decoded.height) throw new Error('Размер точных пикселей не совпадает с изображением.');
  }
  const bytes = pixelBufferByteLength(decoded.width, decoded.height);
  if (bytes > 40000000 * 4) throw new Error('Изображение больше 40 мегапикселей. Уменьшите исходник перед добавлением, чтобы ограничить расход памяти.');
  if (decoded.imageData) {
    pixelBufferFromImageData(decoded.imageData);
    if (decoded.imageData.width !== decoded.width || decoded.imageData.height !== decoded.height) {
      throw new Error('Размеры декодированных пикселей не совпадают с размерами изображения.');
    }
  }
}

// Dependencies are bound by application.mjs after all components are constructed.
export function createDecode({}, deps) {
  async function decodeSourceFile(file) {
    const decoded = await deps.decodeImageBlobOrOptional(file);
    try {
      validateDecodedRaster(decoded);
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (decoded.imageData) ctx.putImageData(decoded.imageData, 0, 0);
      else ctx.drawImage(decoded.image, 0, 0);
      const imageData = decoded.imageData || ctx.getImageData(0, 0, canvas.width, canvas.height);
      const metadata = await deps.readPanoramaMetadata(file);
      return { ...metadata, file, name: file.name || "image", size: file.size || 0, type: file.type || "unknown",
        width: canvas.width, height: canvas.height, canvas, ctx, imageData, pixelBuffer: decoded.pixelBuffer || pixelBufferFromImageData(imageData),
        hasAlpha: decoded.pixelBuffer ? decoded.pixelBuffer.data.some((n,i)=>i%4===3&&n!==2**decoded.pixelBuffer.bitDepth-1) : deps.detectAlpha(imageData.data) };
    } finally { if (decoded.close) decoded.close(); }
  }
  
  async function decodeImageBlobOrOptional(file) {
    // Sniff bytes as well as names: an empty or misleading MIME must not lose PNG16 precision.
    if(deps.decodePngFile){const png=await deps.decodePngFile(file);if(png)return png;}
    const kind = deps.fileKind(file);
    if (kind === 'bmp') return (await deps.loadOptionalCodec('utif')).decodeBmp(file);
    if (kind === 'tiff') return deps.decodeTiffFile(file);
    if (kind === 'jxl' || kind === 'avif') {
      const codec = await deps.loadOptionalCodec(kind === 'avif' ? 'heic' : 'modern');
      return codec.decode(file, kind);
    }
    if (kind === 'ico') {
      if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('ICO: пустой файл или размер более 256 МиБ');
      const png = largestIcoPng(await file.arrayBuffer());
      if (png) return deps.decodeImageBlob(new Blob([png], { type: 'image/png' }));
      return (await deps.loadOptionalCodec('utif')).decodeBmp(file,true);
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
    if (/\.bmp$/.test(name) || type === 'image/bmp' || type === 'image/x-ms-bmp') return 'bmp';
    if (/\.(tif|tiff)$/.test(name) || type === "image/tiff") return "tiff";
    if (/\.(heic|heif)$/.test(name) || type === "image/heic" || type === "image/heif") return "heic";
    for (const [extension, mime] of [['avif', 'image/avif'], ['jxl', 'image/jxl'], ['webp', 'image/webp'], ['ico', 'image/x-icon']]) {
      if (name.endsWith('.' + extension) || type === mime || (extension === 'ico' && type === 'image/vnd.microsoft.icon')) return extension;
    }
    return "";
  }
  
  async function decodeTiffFile(file) {
    deps.showStatus("Открываю TIFF…");
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
  
  async function imageDataToPreview(imageData, exactPixels) {
    const pixelBuffer = exactPixels ? createPixelBuffer(exactPixels) : pixelBufferFromImageData(imageData);
    if(pixelBuffer.width!==imageData.width||pixelBuffer.height!==imageData.height)throw new Error('Размеры точных пикселей и предпросмотра различаются.');
    return {
      bitmap: await createImageBitmap(imageData),
      imageData, pixelBuffer
    };
  }
  
  async function decodeVariantForPreview(blob, exactPng = false) {
    // A preview is valid only if the actual output file can be decoded.
    const decoded = exactPng ? await deps.decodePngFile(blob,true) : await deps.decodeImageBlobOrOptional(blob);
    try {
      validateDecodedRaster(decoded);
      if (decoded.imageData) return { ...await deps.imageDataToPreview(decoded.imageData, decoded.pixelBuffer), blockGrid: decoded.blockGrid || null };
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(decoded.image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return await deps.imageDataToPreview(imageData);
    } finally { if (decoded.close) decoded.close(); }
  }

  return { decodeSourceFile, decodeImageBlobOrOptional, fileKind, decodeTiffFile, decodeHeicFile, decodeImageBlob, imageDataToPreview, decodeVariantForPreview };
}
