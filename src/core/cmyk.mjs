// Exact CMYK code values are independent of the SDR RGB preview.
const MAX_PIXELS = 40_000_000;
const MAX_ICC = 1024 * 1024;
const ascii = (bytes, at, text) => [...text].every((letter, i) => bytes[at + i] === letter.charCodeAt(0));

function exifOrientation(bytes, first, end) {
  if(end-first<14||!ascii(bytes,first,'Exif\0\0'))return 1;
  const base=first+6,little=bytes[base]===73&&bytes[base+1]===73;
  if(!little&&!(bytes[base]===77&&bytes[base+1]===77))return 1;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=at=>at+2<=end?view.getUint16(at,little):null;
  const u32=at=>at+4<=end?view.getUint32(at,little):null;
  if(u16(base+2)!==42)return 1;
  const offset=u32(base+4);if(offset===null||offset>65536)return 1;
  const ifd=base+offset,count=u16(ifd);
  if(count===null||count>1024||ifd+2+count*12>end)return 1;
  for(let i=0;i<count;i++){
    const at=ifd+2+i*12;
    if(u16(at)===274&&u16(at+2)===3&&u32(at+4)===1){
      const value=u16(at+8);return value>=1&&value<=8?value:1;
    }
  }
  return 1;
}

export function validateCmykIcc(profile) {
  if (!(profile instanceof Uint8Array) || profile.length < 132 || profile.length > MAX_ICC ||
      !ascii(profile, 16, 'CMYK') || !ascii(profile, 36, 'acsp'))
    throw new Error('Встроенный ICC не является поддерживаемым CMYK-профилем.');
  const size = new DataView(profile.buffer, profile.byteOffset, profile.byteLength).getUint32(0);
  if (size < 132 || size > profile.length) throw new Error('Некорректная длина CMYK ICC.');
  return profile;
}

export function createCmykRaster(width, height, data, iccProfile = null) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS || !(data instanceof Uint8Array) || data.length !== width * height * 4)
    throw new Error('Некорректный 8-битный CMYK-растр.');
  if (iccProfile !== null) validateCmykIcc(iccProfile);
  return { width, height, data, iccProfile };
}

// Inspect only the JPEG header. ICC APP2 parts are reassembled in sequence;
// incomplete or conflicting sets are never silently copied to an output.
export function readCmykJpegHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
    return null;
  let at = 2, components = null, adobe = null, chunks = null, count = 0, orientation=1;
  while (at + 4 <= bytes.length && ++count <= 4096) {
    if (bytes[at++] !== 255) throw new Error('Повреждённый заголовок JPEG.');
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 218 || marker === 217) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (at + 2 > bytes.length) throw new Error('Обрезанный заголовок JPEG.');
    const length = bytes[at] * 256 + bytes[at + 1];
    if (length < 2 || at + length > bytes.length) throw new Error('Повреждённый сегмент JPEG.');
    const p = at + 2, end = at + length;
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (p + 6 > end) throw new Error('Некорректный заголовок изображения JPEG.');
      components = bytes[p + 5];
    } else if (marker === 238 && end - p >= 12 && ascii(bytes, p, 'Adobe')) adobe = bytes[p + 11];
    else if(marker===225)orientation=exifOrientation(bytes,p,end);
    else if (marker === 226 && end - p >= 15 && ascii(bytes, p, 'ICC_PROFILE\0')) {
      const sequence = bytes[p + 12], total = bytes[p + 13];
      if (!sequence || !total || sequence > total || total > 32 || chunks && chunks.length !== total)
        throw new Error('Некорректные части ICC в JPEG.');
      chunks ??= Array(total).fill(null);
      if (chunks[sequence - 1]) throw new Error('Повторная часть ICC в JPEG.');
      chunks[sequence - 1] = bytes.subarray(p + 14, end);
    }
    at = end;
  }
  if (components !== 4) return null;
  if (adobe !== null && adobe !== 0 && adobe !== 2) throw new Error('Неизвестная цветовая модель четырёхканального JPEG.');
  let iccProfile = null;
  if (chunks) {
    if (chunks.some(part => !part)) throw new Error('ICC-профиль JPEG неполон.');
    const size = chunks.reduce((sum, part) => sum + part.length, 0);
    if (size > MAX_ICC) throw new Error('CMYK ICC превышает 1 МиБ.');
    iccProfile = new Uint8Array(size); let offset = 0;
    for (const part of chunks) { iccProfile.set(part, offset); offset += part.length; }
    validateCmykIcc(iccProfile);
  }
  return { adobe, iccProfile, orientation };
}

export function orientCmyk(cmyk, orientation) {
  const source=createCmykRaster(cmyk.width,cmyk.height,cmyk.data,cmyk.iccProfile);
  if(orientation===1)return source;
  if(!Number.isInteger(orientation)||orientation<2||orientation>8)throw new Error('Некорректная ориентация CMYK.');
  const {width,height}=source,rotated=orientation>=5;
  const target=new Uint8Array(source.data.length),outWidth=rotated?height:width;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let dx=x,dy=y;
    switch(orientation){
      case 2:dx=width-1-x;break;
      case 3:dx=width-1-x;dy=height-1-y;break;
      case 4:dy=height-1-y;break;
      case 5:dx=y;dy=x;break;
      case 6:dx=height-1-y;dy=x;break;
      case 7:dx=height-1-y;dy=width-1-x;break;
      case 8:dx=y;dy=width-1-x;break;
    }
    target.set(source.data.subarray((y*width+x)*4,(y*width+x+1)*4),(dy*outWidth+dx)*4);
  }
  return createCmykRaster(outWidth,rotated?width:height,target,source.iccProfile);
}

export function isFourChannelJpegPrefix(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return false;
  let at=2;
  for(let markers=0;markers<4096&&at+4<=bytes.length;markers++){
    if(bytes[at++]!==255)return false;
    while(bytes[at]===255)at++;
    const marker=bytes[at++];
    if(marker===218||marker===217)return false;
    if(marker===1||marker>=208&&marker<=215)continue;
    if(at+2>bytes.length)return false;
    const length=bytes[at]*256+bytes[at+1];
    if(length<2||at+length>bytes.length)return false;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))
      return length>=8&&bytes[at+7]===4;
    at+=length;
  }
  return false;
}

export function cmykPreview(cmyk) {
  const raster = createCmykRaster(cmyk.width,cmyk.height,cmyk.data,cmyk.iccProfile);
  const rgba = new Uint8ClampedArray(raster.data.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const k = 255 - raster.data[i + 3];
    rgba[i] = Math.round((255 - raster.data[i]) * k / 255);
    rgba[i + 1] = Math.round((255 - raster.data[i + 1]) * k / 255);
    rgba[i + 2] = Math.round((255 - raster.data[i + 2]) * k / 255);
    rgba[i + 3] = 255;
  }
  return { width:raster.width, height:raster.height, data:rgba };
}

export function cmykStatistics(cmyk, reference = null, threshold = 300, region = null) {
  const raster = createCmykRaster(cmyk.width,cmyk.height,cmyk.data,cmyk.iccProfile);
  if(reference)createCmykRaster(reference.width,reference.height,reference.data,reference.iccProfile);
  if(reference && (reference.width!==raster.width||reference.height!==raster.height))
    throw new Error('Для сравнения CMYK нужны одинаковые размеры.');
  if(!Number.isInteger(threshold)||threshold<0||threshold>400)throw new Error('Порог суммы красок должен быть 0–400%.');
  const {width,height,data}=raster;
  if(region&&![region.x,region.y,region.width,region.height].every(Number.isFinite))
    throw new Error('Некорректная область CMYK-анализа.');
  const box=region?{x:Math.max(0,Math.floor(region.x)),y:Math.max(0,Math.floor(region.y)),
    width:Math.min(width-Math.max(0,Math.floor(region.x)),Math.floor(region.width)),
    height:Math.min(height-Math.max(0,Math.floor(region.y)),Math.floor(region.height))}:
    {x:0,y:0,width,height};
  if(box.width<=0||box.height<=0)throw new Error('Пустая область CMYK-анализа.');
  const histograms=Array.from({length:4},()=>new Uint32Array(256));
  const sum=[0,0,0,0],absolute=[0,0,0,0];
  let overLimit=0,peakTac=-1,peakTacPoint=null,firstOverPoint=null,peakDifference=0;
  let kOnlyPixels=0,kOnlyRetained=0;
  for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
    const at=(y*width+x)*4;let total=0,pointDifference=0;
    for(let c=0;c<4;c++){
      const value=data[at+c];histograms[c][value]++;sum[c]+=value;total+=value;
      if(reference){const delta=Math.abs(value-reference.data[at+c]);absolute[c]+=delta;pointDifference=Math.max(pointDifference,delta);}
    }
    const tac=total*100/255;
    if(tac>peakTac){peakTac=tac;peakTacPoint={x,y};}
    if(tac>threshold){overLimit++;firstOverPoint??={x,y};}
    const expected=reference||raster,expectedData=expected.data;
    if(expectedData[at]===0&&expectedData[at+1]===0&&expectedData[at+2]===0&&expectedData[at+3]>0){
      kOnlyPixels++;
      if(data[at]===0&&data[at+1]===0&&data[at+2]===0&&data[at+3]>0)kOnlyRetained++;
    }
    peakDifference=Math.max(peakDifference,pointDifference);
  }
  const pixels=box.width*box.height;
  return {width:box.width,height:box.height,pixelCount:pixels,histograms,
    means:sum.map(n=>n/pixels/255*100),tacMaximum:peakTac,tacOverPixels:overLimit,
    tacOverPercent:overLimit/pixels*100,threshold,peakTacPoint,firstOverPoint,
    kOnly:{sourcePixels:kOnlyPixels,retainedPixels:kOnlyRetained,lostPixels:kOnlyPixels-kOnlyRetained},
    difference:reference?{meanAbsolute:absolute.map(n=>n/pixels/255*100),peak:peakDifference/255*100}:null};
}

export function cmykDiagnostic(cmyk, reference = null, threshold = 300, region = null) {
  const stats=cmykStatistics(cmyk,reference,threshold,region);
  const box=region?{x:Math.max(0,Math.floor(region.x)),y:Math.max(0,Math.floor(region.y))}:{x:0,y:0};
  const scale=Math.max(1,Math.ceil(Math.max(stats.width,stats.height)/512));
  const width=Math.ceil(stats.width/scale),height=Math.ceil(stats.height/scale);
  // Keep the exact 0..1020 sum so pixels close to the threshold are not
  // misclassified by an 8-bit display map.
  const tac=new Uint16Array(width*height),difference=reference?new Uint8Array(width*height):null;
  const kOnly=new Uint8Array(width*height);
  for(let y=0;y<stats.height;y++)for(let x=0;x<stats.width;x++){
    const at=((box.y+y)*cmyk.width+box.x+x)*4,to=Math.floor(y/scale)*width+Math.floor(x/scale);
    let total=0,delta=0;
    for(let c=0;c<4;c++){
      total+=cmyk.data[at+c];
      if(reference)delta=Math.max(delta,Math.abs(cmyk.data[at+c]-reference.data[at+c]));
    }
    tac[to]=Math.max(tac[to],total);
    if(difference)difference[to]=Math.max(difference[to],delta);
    const expected=(reference||cmyk).data;
    if(expected[at]===0&&expected[at+1]===0&&expected[at+2]===0&&expected[at+3]>0){
      const retained=cmyk.data[at]===0&&cmyk.data[at+1]===0&&cmyk.data[at+2]===0&&cmyk.data[at+3]>0;
      kOnly[to]=Math.max(kOnly[to],retained?1:2);
    }
  }
  return {...stats,maps:{width,height,scale,tac,difference,kOnly}};
}
