import { createPixelBuffer, clonePixelBuffer } from './pixel-buffer.mjs';

export function pixelBufferFromImageData(imageData) {
  if (!(imageData?.data instanceof Uint8ClampedArray)) {
    throw new TypeError('Текущий адаптер ImageData принимает только RGBA8.');
  }
  return createPixelBuffer({ width: imageData.width, height: imageData.height, data: imageData.data,
    colorSpace: imageData.colorSpace ?? 'unknown', alphaMode: 'straight' });
}

export function pixelBufferToImageData(pixels) {
  const validated = createPixelBuffer(pixels);
  if (validated.sampleType !== 'uint8' || validated.bitDepth !== 8 || validated.alphaMode !== 'straight') {
    throw new TypeError('Для ImageData нужен RGBA8 с независимым каналом прозрачности.');
  }
  const data = validated.data instanceof Uint8ClampedArray ? validated.data
    : new Uint8ClampedArray(validated.data.buffer, validated.data.byteOffset, validated.data.length);
  const settings = validated.colorSpace === 'unknown' ? undefined : { colorSpace: validated.colorSpace };
  return new ImageData(data, validated.width, validated.height, settings);
}

export function cloneImageData(imageData) {
  return pixelBufferToImageData(clonePixelBuffer(pixelBufferFromImageData(imageData)));
}
