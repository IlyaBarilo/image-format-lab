import { createPixelBuffer } from './pixel-buffer.mjs';
import { indexedPalette } from './gif.mjs';

// Exact static PNG samples; display conversion is deliberately separate.
// Container, byte order, filters and Adam7: https://www.w3.org/TR/png-3/
export const PNG_MAX_PIXELS = 12000000;
export const PNG_MAX_FILE_BYTES = 128 * 1024 * 1024;
const signature = [137,80,78,71,13,10,26,10];
const channels = {0:1,2:3,4:2,6:4};
const adam7 = [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
const crcTable = Uint32Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = n&1 ? 0xedb88320^(n>>>1) : n>>>1;
  return n>>>0;
});
function crc(bytes) {
  let n=0xffffffff;
  for (const b of bytes) n=crcTable[(n^b)&255]^(n>>>8);
  return (n^0xffffffff)>>>0;
}
const fail = message => { throw new Error('PNG: '+message); };
const view = bytes => new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
export function pngHeader(bytes) {
  if (bytes.length<8 || signature.some((b,i)=>bytes[i]!==b)) return null;
  if (bytes.length<33 || view(bytes).getUint32(8)!==13 || String.fromCharCode(...bytes.subarray(12,16))!=='IHDR') fail('повреждён заголовок.');
  const v=view(bytes),width=v.getUint32(16),height=v.getUint32(20),depth=bytes[24],type=bytes[25];
  if (!width||!height||width>0x7fffffff||height>0x7fffffff||bytes[26]||bytes[27]||bytes[28]>1) fail('недопустимые параметры изображения.');
  const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  if (!depths[type]?.includes(depth)) fail('недопустимая разрядность или тип цвета.');
  return {width,height,depth,type,interlace:bytes[28]};
}
export function checkPngSize(width,height) {
  if (![width,height].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(width*height)||width*height>PNG_MAX_PIXELS) fail('точный путь ограничен 12 мегапикселями для контроля памяти.');
}
function passesFor(h) {
  return (h.interlace?adam7:[[0,0,1,1]]).map(([x,y,dx,dy])=>({x,y,dx,dy,
    width:Math.max(0,Math.ceil((h.width-x)/dx)),height:Math.max(0,Math.ceil((h.height-y)/dy))})).filter(p=>p.width&&p.height);
}
function paeth(a,b,c) {
  const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
  return da<=db&&da<=dc?a:db<=dc?b:c;
}
export function normalizePngOptions(value={}) {
  const pngFilter=value.pngFilter??'default', pngLevel=value.pngLevel??6;
  if(!['default','adaptive','none','sub','up','average','paeth'].includes(pngFilter)||!Number.isInteger(pngLevel)||pngLevel<1||pngLevel>9)
    fail('неверные настройки фильтра или уровня Deflate.');
  return {pngFilter,pngLevel};
}
function filterRow(output,offset,row,previous,bpp,choice) {
  const methods=choice==='adaptive'?[0,1,2,3,4]:[{none:0,sub:1,up:2,average:3,paeth:4}[choice]];
  let best=methods[0],bestScore=Infinity;
  for(const method of methods){
    let score=0;
    for(let i=0;i<row.length;i++){
      const left=i>=bpp?row[i-bpp]:0,above=previous[i],upperLeft=i>=bpp?previous[i-bpp]:0;
      const predictor=method===0?0:method===1?left:method===2?above:method===3?Math.floor((left+above)/2):paeth(left,above,upperLeft);
      const filtered=(row[i]-predictor)&255;
      score+=Math.abs(filtered<128?filtered:filtered-256);
    }
    if(score<bestScore){bestScore=score;best=method;}
  }
  output[offset]=best;
  for(let i=0;i<row.length;i++){
    const left=i>=bpp?row[i-bpp]:0,above=previous[i],upperLeft=i>=bpp?previous[i-bpp]:0;
    const predictor=best===0?0:best===1?left:best===2?above:best===3?Math.floor((left+above)/2):paeth(left,above,upperLeft);
    output[offset+1+i]=(row[i]-predictor)&255;
  }
}
export function decodePng(bytes, pako) {
  if (!(bytes instanceof Uint8Array)||bytes.length>PNG_MAX_FILE_BYTES) fail('файл больше 128 МиБ или имеет неверный тип.');
  const h=pngHeader(bytes);
  if (!h||![8,16].includes(h.depth)||!channels[h.type]) fail('точное чтение поддерживает серый, RGB, серый с alpha и RGBA по 8/16 бит.');
  checkPngSize(h.width,h.height);
  const parts=[],seen=new Set(); let ended=false,idatEnded=false,transparency=null,srgb=false;
  const colorChunks=new Map();
  for (let at=8;at<bytes.length;) {
    if (at+12>bytes.length) fail('обрезан блок.');
    const v=view(bytes),size=v.getUint32(at),end=at+12+size;
    if (size>0x7fffffff||end>bytes.length) fail('неверная длина блока.');
    const nameBytes=bytes.subarray(at+4,at+8),name=String.fromCharCode(...nameBytes),data=bytes.subarray(at+8,end-4);
    if (!/^[A-Za-z]{4}$/.test(name)||nameBytes[2]&32) fail('неверное имя блока.');
    if (crc(bytes.subarray(at+4,end-4))!==v.getUint32(end-4)) fail('ошибка контрольной суммы '+name+'.');
    if (name==='IHDR' && (at!==8||seen.has(name))) fail('повторный заголовок.');
    if (parts.length&&name!=='IDAT') idatEnded=true;
    if (name==='IDAT') { if(idatEnded)fail('блоки IDAT должны идти подряд.'); parts.push(data); }
    else if (name==='IEND') { if(size||!parts.length||end!==bytes.length)fail('неверный конец файла.'); ended=true; }
    else if (name==='tRNS') {
      if(seen.has(name)||parts.length||![0,2].includes(h.type)||size!==(h.type===0?2:6))fail('неверный блок прозрачности.');
      transparency=Array.from({length:size/2},(_,i)=>view(data).getUint16(i*2));
      if(transparency.some(n=>n>2**h.depth-1))fail('прозрачный цвет вне диапазона.');
    } else if (['sRGB','gAMA','cHRM','iCCP','cICP','mDCV','cLLI'].includes(name)) {
      if(seen.has(name)||parts.length)fail('неверный порядок цветовых блоков.');
      colorChunks.set(name,data);
      if(name==='sRGB'){if(size!==1||data[0]>3)fail('неверная метка sRGB.');srgb=true;}
    } else if (name==='PLTE') {
      if(seen.has(name)||parts.length||![2,6].includes(h.type)||!size||size%3||size>768)fail('неверная палитра.');
    } else if (!(nameBytes[0]&32)&&name!=='IHDR') fail('неподдержанный обязательный блок '+name+'.');
    seen.add(name);at=end;
  }
  if(!ended)fail('нет конца файла.');
  const standardChromaticities=[31270,32900,64000,33000,30000,60000,15000,6000];
  for(const [name,data] of colorChunks){
    if(name==='sRGB')continue;
    if(name==='gAMA'&&srgb&&data.length===4&&view(data).getUint32(0)===45455)continue;
    if(name==='cHRM'&&srgb&&data.length===32&&standardChromaticities.every((n,i)=>view(data).getUint32(i*4)===n))continue;
    fail('точное чтение этого цветового описания ('+name+') пока не поддерживается. Нужен PNG с sRGB или без цветовых блоков; ICC/HDR-преобразование не выполняется.');
  }
  const count=channels[h.type],bpp=count*(h.depth/8),passes=passesFor(h);
  const expected=passes.reduce((n,p)=>n+(p.width*bpp+1)*p.height,0);
  // Bounded streaming inflate: a corrupt stream cannot grow an unbounded result.
  const raw=new Uint8Array(expected);let written=0;
  const inflater=new pako.Inflate({chunkSize:65536});
  inflater.onData=chunk=>{if(written+chunk.length>expected)fail('распакованный поток больше ожидаемого.');raw.set(chunk,written);written+=chunk.length;};
  for(let i=0;i<parts.length;i++){
    if(inflater.ended&&parts[i].length)fail('лишний сжатый поток.');
    inflater.push(parts[i],i===parts.length-1);
    if(inflater.err)fail('повреждён сжатый поток.');
  }
  if(!inflater.ended||written!==expected||inflater.strm.total_in!==parts.reduce((n,p)=>n+p.length,0))fail('неполный или избыточный поток пикселей.');
  const data=h.depth===16?new Uint16Array(h.width*h.height*4):new Uint8ClampedArray(h.width*h.height*4),peak=2**h.depth-1;
  let at=0;
  for(const p of passes){
    const rowSize=p.width*bpp;
    let previous=new Uint8Array(rowSize),row=new Uint8Array(rowSize);
    for(let y=0;y<p.height;y++){
      const filter=raw[at++];if(filter>4)fail('неизвестный фильтр строки.');
      for(let i=0;i<rowSize;i++){
        const a=i>=bpp?row[i-bpp]:0,b=previous[i],c=i>=bpp?previous[i-bpp]:0;
        row[i]=(raw[at++]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
      }
      for(let x=0;x<p.width;x++){
        const dest=((p.y+y*p.dy)*h.width+p.x+x*p.dx)*4,start=x*bpp;
        const sample=c=>h.depth===16?(row[start+c*2]<<8)|row[start+c*2+1]:row[start+c];
        const gray=h.type===0||h.type===4;
        data[dest]=sample(0);data[dest+1]=sample(gray?0:1);data[dest+2]=sample(gray?0:2);
        data[dest+3]=h.type===4?sample(1):h.type===6?sample(3):transparency&&transparency.every((n,c)=>n===sample(c))?0:peak;
      }
      [row,previous]=[previous,row];
    }
  }
  return createPixelBuffer({width:h.width,height:h.height,data,sampleType:h.depth===16?'uint16':'uint8',colorSpace:srgb?'srgb':'unknown'});
}
function chunk(name,data){
  const out=new Uint8Array(data.length+12),v=view(out);v.setUint32(0,data.length);
  for(let i=0;i<4;i++)out[4+i]=name.charCodeAt(i);
  out.set(data,8);v.setUint32(out.length-4,crc(out.subarray(4,out.length-4)));return out;
}
function rowDeflater(pako,level,pieces){
  if(typeof pako?.Deflate!=='function')fail('кодировщик Deflate недоступен.');
  const deflater=new pako.Deflate({level,chunkSize:65536});
  deflater.onData=data=>{
    for(let at=0;at<data.length;at+=1048576)pieces.push(chunk('IDAT',data.subarray(at,at+1048576)));
  };
  return (row,last)=>{
    deflater.push(row,last);
    if(deflater.err)fail('ошибка сжатия Deflate.');
    if(last&&!deflater.ended)fail('неполный поток Deflate.');
  };
}
export function encodeIndexedPng(source,maxColors,useDither,pako,options={}){
  checkPngSize(source.width,source.height);
  const {pngFilter,pngLevel}=normalizePngOptions(options);
  const {palette,indexed,transparentIndex,paletteInfo}=indexedPalette(maxColors,useDither,source);
  const depth=palette.length<=2?1:palette.length<=4?2:palette.length<=16?4:8;
  const rowSize=Math.ceil(source.width*depth/8);
  const header=new Uint8Array(13),v=view(header);
  v.setUint32(0,source.width);v.setUint32(4,source.height);
  header[8]=depth;header[9]=3;
  const plte=new Uint8Array(palette.length*3);
  palette.forEach((color,i)=>plte.set([color.r,color.g,color.b],i*3));
  const pieces=[new Uint8Array(signature),chunk('IHDR',header),chunk('PLTE',plte)];
  if(transparentIndex>=0)pieces.push(chunk('tRNS',Uint8Array.of(0)));
  const pushRow=rowDeflater(pako,pngLevel,pieces);
  const filtered=new Uint8Array(rowSize+1);
  let previous=new Uint8Array(rowSize);
  for(let y=0;y<source.height;y++){
    const row=new Uint8Array(rowSize);
    for(let x=0;x<source.width;x++){
      const index=indexed[y*source.width+x],at=x*depth>>3;
      row[at]|=index<<(8-depth-(x*depth&7));
    }
    filterRow(filtered,0,row,previous,1,pngFilter==='default'?'none':pngFilter);
    pushRow(filtered,y===source.height-1);
    previous=row;
  }
  pieces.push(chunk('IEND',new Uint8Array()));
  return {blob:new Blob(pieces,{type:'image/png'}),previewImageData:null,
    paletteInfo:{...paletteInfo,storedEntries:palette.length,indexDepth:depth}};
}
export function pngDepth(value='auto'){
  if(!['auto','8','16'].includes(value))fail('выберите Авто, 8 или 16 бит на канал.');
  return value;
}
export function resolvedPngDepth(value,pixels){return pngDepth(value)==='auto'?(pixels.bitDepth>8?16:8):Number(value);}
export function encodePng(input,depth,pako,options={}){
  const pixels=createPixelBuffer(input);checkPngSize(pixels.width,pixels.height);
  const {pngFilter,pngLevel}=normalizePngOptions(options);
  if(![8,16].includes(depth)||!['uint8','uint16'].includes(pixels.sampleType)||pixels.alphaMode!=='straight')fail('для записи нужны целые независимые каналы RGB и alpha.');
  if(!['srgb','unknown'].includes(pixels.colorSpace))fail('запись этого цветового пространства пока не поддерживается.');
  const peak=2**pixels.bitDepth-1,outPeak=2**depth-1,bpp=4*depth/8,rowSize=pixels.width*bpp;
  const header=new Uint8Array(13);view(header).setUint32(0,pixels.width);view(header).setUint32(4,pixels.height);header[8]=depth;header[9]=6;
  const pieces=[new Uint8Array(signature),chunk('IHDR',header)];
  if(pixels.colorSpace==='srgb')pieces.push(chunk('sRGB',new Uint8Array([0])));
  const pushRow=rowDeflater(pako,pngLevel,pieces);
  const filtered=new Uint8Array(rowSize+1),row=new Uint8Array(rowSize),previous=new Uint8Array(rowSize);
  for(let y=0;y<pixels.height;y++){
    for(let i=0;i<pixels.width*4;i++){
      const value=pixels.data[(y*pixels.width*4)+i];if(value>peak)fail('отсчёт вне диапазона.');
      const n=Math.round(value/peak*outPeak);
      if(depth===16){row[i*2]=n>>>8;row[i*2+1]=n&255;}else row[i]=n;
    }
    filterRow(filtered,0,row,previous,bpp,pngFilter==='default'?'sub':pngFilter);
    pushRow(filtered,y===pixels.height-1);
    previous.set(row);
  }
  pieces.push(chunk('IEND',new Uint8Array()));
  return new Blob(pieces,{type:'image/png'});
}
export function pngPreview(pixels){
  const p=createPixelBuffer(pixels),peak=2**p.bitDepth-1;
  if(!['uint8','uint16'].includes(p.sampleType)||p.alphaMode!=='straight')fail('предпросмотр требует независимых целых каналов.');
  const data=new Uint8ClampedArray(p.data.length);
  for(let i=0;i<data.length;i++)data[i]=Math.round(p.data[i]/peak*255);
  return {width:p.width,height:p.height,data};
}
