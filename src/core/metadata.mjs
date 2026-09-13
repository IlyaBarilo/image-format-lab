

export async function readPanoramaMetadata(file) {
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (signature[0] !== 0xff || signature[1] !== 0xd8) return { panorama: null, panoramaError: null };
  try {
    return { panorama: parseJpegPanorama(new Uint8Array(await file.arrayBuffer())), panoramaError: null };
  } catch (error) { return { panorama: null, panoramaError: error.message || String(error) }; }
}

export function parseJpegPanorama(bytes) {
  const namespace = "http://ns.google.com/photos/1.0/panorama/";
  const xmpHeader = "http://ns.adobe.com/xap/1.0/\0";
  const properties = {};
  const allowed = new Set(["UsePanoramaViewer", "CaptureSoftware", "StitchingSoftware", "ProjectionType",
    "PoseHeadingDegrees", "PosePitchDegrees", "PoseRollDegrees", "InitialViewHeadingDegrees",
    "InitialViewPitchDegrees", "InitialViewRollDegrees", "InitialHorizontalFOVDegrees", "InitialVerticalFOVDegrees",
    "FirstPhotoDate", "LastPhotoDate", "SourcePhotosCount", "ExposureLockUsed", "CroppedAreaImageWidthPixels",
    "CroppedAreaImageHeightPixels", "FullPanoWidthPixels", "FullPanoHeightPixels", "CroppedAreaLeftPixels",
    "CroppedAreaTopPixels", "InitialCameraDolly"]);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("Некорректная структура JPEG при чтении метаданных");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("Оборванный заголовок JPEG");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error("Оборванные метаданные JPEG");
    if (marker === 0xe1) {
      const payload = new TextDecoder().decode(bytes.subarray(offset + 2, offset + length));
      if (payload.includes(namespace)) {
        if (!payload.startsWith(xmpHeader)) throw new Error("GPano в расширенном XMP пока не поддерживается");
        const xml = new DOMParser().parseFromString(payload.slice(xmpHeader.length), "application/xml");
        if (xml.getElementsByTagName("parsererror").length) throw new Error("Повреждённый XMP с данными GPano");
        for (const element of xml.getElementsByTagName("*")) {
          if (element.namespaceURI === namespace && allowed.has(element.localName)) properties[element.localName] = element.textContent;
          for (const attr of element.attributes) {
            if (attr.namespaceURI === namespace && allowed.has(attr.localName)) properties[attr.localName] = attr.value;
          }
        }
      }
    }
    offset += length;
  }
  return Object.keys(properties).length ? properties : null;
}

export function scaledPanorama(properties, sourceWidth, sourceHeight, width, height) {
  const result = { ...properties };
  const number = (key) => {
    const value = Number(properties[key]);
    if (properties[key] === undefined || !Number.isFinite(value)) throw new Error("В GPano отсутствует корректное поле " + key);
    return value;
  };
  const cropWidth = number("CroppedAreaImageWidthPixels");
  const cropHeight = number("CroppedAreaImageHeightPixels");
  const fullWidth = number("FullPanoWidthPixels"), fullHeight = number("FullPanoHeightPixels");
  if (!properties.ProjectionType || cropWidth <= 0 || cropHeight <= 0 || fullWidth <= 0 || fullHeight <= 0) {
    throw new Error("Некорректные размеры или проекция GPano");
  }
  if (Math.abs(sourceWidth / sourceHeight / (cropWidth / cropHeight) - 1) > 0.005) {
    throw new Error("Пропорции GPano не совпадают с исходником; сохранение панорамы требует проверки");
  }
  const scaleX = width / cropWidth, scaleY = height / cropHeight;
  result.CroppedAreaImageWidthPixels = String(width);
  result.CroppedAreaImageHeightPixels = String(height);
  result.FullPanoWidthPixels = String(Math.round(fullWidth * scaleX));
  result.FullPanoHeightPixels = String(Math.round(fullHeight * scaleY));
  result.CroppedAreaLeftPixels = String(Math.round(number("CroppedAreaLeftPixels") * scaleX));
  result.CroppedAreaTopPixels = String(Math.round(number("CroppedAreaTopPixels") * scaleY));
  return result;
}

export function embedJpegPanorama(blob, properties) {
  const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const fields = Object.entries(properties).map(([key, value]) => '<GPano:' + key + '>' + escape(value) + '</GPano:' + key + '>').join("");
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">' + fields
    + '</rdf:Description></rdf:RDF></x:xmpmeta>';
  const payload = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0" + xml);
  if (payload.length > 65533) throw new Error("Данные GPano слишком велики для JPEG APP1");
  const header = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]);
  return new Blob([blob.slice(0, 2), header, payload, blob.slice(2)], { type: "image/jpeg" });
}
