// Synthetic, original fixtures only; native WASM runs in Node without a browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const arrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
function bmp({bits=8,compression=0,width=4,height=1,bytes,palette=true,masks=[]}) {
  const colors=palette?[[0,0,0],[255,0,0],[0,255,0],[0,0,255]]:[];
  const offset=54+colors.length*4+masks.length*4,b=Buffer.alloc(offset+bytes.length);
  b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(offset,10);b.writeUInt32LE(40,14);
  b.writeInt32LE(width,18);b.writeInt32LE(height,22);b.writeUInt16LE(1,26);b.writeUInt16LE(bits,28);
  b.writeUInt32LE(compression,30);b.writeUInt32LE(bytes.length,34);b.writeUInt32LE(colors.length,46);
  masks.forEach((v,i)=>b.writeUInt32LE(v,54+i*4));
  colors.forEach(([r,g,blue],i)=>b.set([blue,g,r,0],54+masks.length*4+i*4));b.set(bytes,offset);return arrayBuffer(b);
}
function tiff({big=false,little=true,planar=false,bits=8,orientation=1,width=2,height=2,tiled=false,alpha=false}={}) {
  const colors=[255,0,0,0,255,0,0,0,255,255,255,255],spp=alpha?4:3,storageWidth=tiled?16:width,storageHeight=tiled?16:height;
  const stride=storageWidth*storageHeight*bits/8,bytes=Buffer.alloc(stride*spp);
  for(let p=0;p<width*height;p++)for(let c=0;c<spp;c++){
    const storage=Math.floor(p/width)*storageWidth+p%width,v=c===3?p*67%256:colors[p*3+c]??p*19%256;
    const at=(planar?c*storageWidth*storageHeight+storage:storage*spp+c)*(bits/8);if(bits===16)bytes[little?'writeUInt16LE':'writeUInt16BE'](v*257,at);else bytes[at]=v;
  }
  const tags=[[256,4,[width]],[257,4,[height]],[258,3,Array(spp).fill(bits)],[259,3,[1]],[262,3,[2]],
    [tiled?324:273,big?16:4,Array(planar?spp:1).fill(0)],[274,3,[orientation]],[277,3,[spp]],
    [tiled?325:279,4,planar?Array(spp).fill(stride):[bytes.length]],[284,3,[planar?2:1]]];
  if(tiled)tags.push([322,4,[16]],[323,4,[16]]);else tags.push([278,4,[height]]);
  if(alpha)tags.push([338,3,[2]]);tags.sort((a,b)=>a[0]-b[0]);
  const start=big?16:8,count=big?8:2,entry=big?20:12,inline=big?8:4;
  let end=start+count+tags.length*entry+(big?8:4);const locations=[];
  for(const [,type,v] of tags){const length=v.length*(type===3?2:type===16?8:4);locations.push(length>inline?end:null);if(length>inline)end+=length;}
  const dataAt=end;tags.find(t=>t[0]===(tiled?324:273))[2]=planar?Array.from({length:spp},(_,i)=>dataAt+stride*i):[dataAt];
  const out=Buffer.alloc(end+bytes.length),view=new DataView(out.buffer,out.byteOffset,out.byteLength);
  const u16=(at,v)=>view.setUint16(at,v,little),u32=(at,v)=>view.setUint32(at,v,little),u64=(at,v)=>view.setBigUint64(at,BigInt(v),little);
  out.write(little?'II':'MM');u16(2,big?43:42);if(big){u16(4,8);u64(8,16);u64(start,tags.length);}else{u32(4,8);u16(start,tags.length);}
  tags.forEach(([tag,type,values],i)=>{const at=start+count+i*entry;u16(at,tag);u16(at+2,type);(big?u64:u32)(at+4,values.length);
    const field=at+(big?12:8),valueAt=locations[i]??field;if(locations[i]!==null)(big?u64:u32)(field,valueAt);
    values.forEach((v,j)=>type===3?u16(valueAt+j*2,v):type===16?u64(valueAt+j*8,v):u32(valueAt+j*4,v));
  });out.set(bytes,end);return arrayBuffer(out);
}
(async()=>{
  const {decodeBmpPixels,decodeTiffPixels,encodeTiffPixels,normalizeTiffOptions}=await import('../src/core/raster-codecs.mjs');
  const {encodeBmp,encodeBmp8}=await import('../src/core/bmp.mjs');
  const bmpCodec=await require('../vendor/bmp-decoder.js')({print(){},printErr(){}});
  const tiffCodec=await require('../vendor/tiff-codec.js')({print(){},printErr(){}});
  const image={width:17,height:13,data:Uint8ClampedArray.from({length:17*13*4},(_,i)=>i*37%256)};
  const unchanged=image.data.slice();
  for(const bits of [24,32]){
    const encoded=encodeBmp(bits===32,'white',{width:image.width,height:image.height,imageData:image},false);
    const actual=decodeBmpPixels(bmpCodec,await encoded.blob.arrayBuffer());
    const expected=new Uint8ClampedArray(image.data);
    if(bits===24)for(let i=0;i<expected.length;i+=4){const alpha=expected[i+3]/255;for(let c=0;c<3;c++)expected[i+c]=Math.round(expected[i+c]*alpha+255*(1-alpha));expected[i+3]=255;}
    assert.deepEqual(new Uint8ClampedArray(actual.buffer),expected,`BMP${bits} including alpha`);
  }
  const transparent={width:2,height:1,imageData:{data:Uint8ClampedArray.of(123,45,67,0,89,123,0,0)}};
  assert.deepEqual(new Uint8ClampedArray(decodeBmpPixels(bmpCodec,await encodeBmp(true,'white',transparent,false).blob.arrayBuffer()).buffer),transparent.imageData.data);
  const indexed={width:13,height:3,imageData:{data:new Uint8ClampedArray(13*3*4)}};
  const bmpPalette=[[0,0,0],[255,0,0],[0,255,0],[0,0,255]];
  const rows=[[0,0,0,0,1,2,3,1,2,3,3,3,3],[2,1,0,3,2,1,0,3,2,1,0,3,2],[1,1,1,1,1,1,1,1,1,1,1,1,1]];
  for(let y=0;y<3;y++)for(let x=0;x<13;x++)indexed.imageData.data.set([...bmpPalette[rows[y][x]],255],(y*13+x)*4);
  const plain=encodeBmp8(16,'none','white',indexed,false),compressed=encodeBmp8(16,'rle8','white',indexed,false);
  const plainBytes=Buffer.from(await plain.blob.arrayBuffer()),rleBytes=Buffer.from(await compressed.blob.arrayBuffer());
  for(const [bytes,method] of [[plainBytes,0],[rleBytes,1]]){
    assert.equal(bytes.toString('ascii',0,2),'BM');assert.equal(bytes.readUInt32LE(2),bytes.length);
    assert.equal(bytes.readUInt16LE(28),8);assert.equal(bytes.readUInt32LE(30),method);
    assert.ok(bytes.readUInt32LE(46)<=16);assert.equal(bytes.readUInt32LE(10),54+bytes.readUInt32LE(46)*4);
    assert.equal(bytes.readUInt32LE(34),bytes.length-bytes.readUInt32LE(10));
  }
  assert.equal(plainBytes.length,plainBytes.readUInt32LE(10)+16*3,'uncompressed rows are padded to four bytes');
  assert.deepEqual([...new Uint8Array(decodeBmpPixels(bmpCodec,plainBytes.buffer.slice(plainBytes.byteOffset,plainBytes.byteOffset+plainBytes.length)).buffer)],
    [...indexed.imageData.data],'BMP8 keeps the four exact palette colors in bottom-up rows');
  assert.deepEqual(new Uint8Array(decodeBmpPixels(bmpCodec,rleBytes.buffer.slice(rleBytes.byteOffset,rleBytes.byteOffset+rleBytes.length)).buffer),
    new Uint8Array(indexed.imageData.data),'RLE8 decodes to exactly the same colors');
  const stream=rleBytes.subarray(rleBytes.readUInt32LE(10));
  assert.deepEqual([...stream.subarray(-2)],[0,1],'RLE8 closes the bitmap');
  assert.ok(stream.includes(0),'RLE8 contains escape records');
  const manyColors={width:27,height:1,imageData:{data:new Uint8ClampedArray(27*4)}};
  let colorAt=0;
  for(const r of [0,128,255])for(const g of [0,128,255])for(const b of [0,128,255])
    manyColors.imageData.data.set([r,g,b,255],colorAt++*4);
  const budget16=Buffer.from(await encodeBmp8(16,'none','white',manyColors,false).blob.arrayBuffer());
  assert.equal(budget16.readUInt32LE(46),16,'16-color budget can use all 16 palette entries');
  const longRun={width:260,height:1,imageData:{data:new Uint8ClampedArray(260*4)}};
  for(let p=0;p<260*4;p+=4)longRun.imageData.data.set([255,0,0,255],p);
  const longRle=Buffer.from(await encodeBmp8(2,'rle8','white',longRun,false).blob.arrayBuffer());
  assert.deepEqual([...longRle.subarray(longRle.readUInt32LE(10))],[255,0,5,0,0,1],'RLE8 splits runs longer than 255 pixels');
  const alphaBmp={width:2,height:1,imageData:{data:Uint8ClampedArray.of(80,20,5,0,0,0,0,255)}};
  const paletteResult=encodeBmp8(2,'none','white',alphaBmp,false);
  assert.equal(paletteResult.paletteInfo.entries.reduce((sum,entry)=>sum+entry.pixels,0),2);
  for(const [matte,expected] of [['white',[255,255,255,255,0,0,0,255]],['black',[0,0,0,255,0,0,0,255]]]){
    const result=encodeBmp8(2,'rle8',matte,alphaBmp,false);
    assert.deepEqual([...new Uint8Array(decodeBmpPixels(bmpCodec,await result.blob.arrayBuffer()).buffer)],expected,'BMP8 composites transparency before quantizing');
  }
  for(const [colors,compression] of [[1,'none'],[257,'none'],[16,'zip']])assert.throws(()=>encodeBmp8(colors,compression,'white',indexed,false));
  assert.deepEqual(indexed.imageData.data,Uint8ClampedArray.from(rows.flatMap(row=>row.flatMap(i=>[...bmpPalette[i],255]))),'BMP8 must not mutate source pixels');
  const dib=Buffer.from(bmp({bits:24,palette:false,width:2,bytes:[0,0,255,0,255,0,0,0]})).subarray(14);
  dib.writeInt32LE(2,8);const icon=Buffer.alloc(22+dib.length+4);icon.writeUInt16LE(1,2);icon.writeUInt16LE(1,4);icon[6]=2;icon[7]=1;icon.writeUInt16LE(1,10);icon.writeUInt16LE(24,12);icon.writeUInt32LE(dib.length+4,14);icon.writeUInt32LE(22,18);icon.set(dib,22);icon[22+dib.length]=0x40;
  assert.deepEqual([...new Uint8Array(decodeBmpPixels(bmpCodec,arrayBuffer(icon),true).buffer)],[255,0,0,255,0,255,0,0],'ICO BMP and transparency mask');
  const colors=[255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255];
  for(const options of [
    {bits:4,bytes:[0x12,0x30,0,0]}, {bits:8,bytes:[1,2,3,0]},
    {bits:8,compression:1,bytes:[0,4,1,2,3,0,0,1]},
    {bits:4,compression:2,bytes:[0,4,0x12,0x30,0,1]},
    {bits:8,height:-1,bytes:[1,2,3,0]}
  ])assert.deepEqual([...new Uint8Array(decodeBmpPixels(bmpCodec,bmp(options)).buffer)],colors,JSON.stringify(options));
  assert.deepEqual([...new Uint8Array(decodeBmpPixels(bmpCodec,bmp({bits:1,bytes:[0xa0,0,0,0]})).buffer)],[255,0,0,255,0,0,0,255,255,0,0,255,0,0,0,255]);
  for(const [compression,masks,red] of [[0,[],0x7c00],[3,[0xf800,0x7e0,0x1f],0xf800]]){
    const result=decodeBmpPixels(bmpCodec,bmp({bits:16,width:1,palette:false,compression,masks,bytes:[red&255,red>>8,0,0]}));
    assert.deepEqual([...new Uint8Array(result.buffer)],[255,0,0,255]);
  }
  for(const bad of [new ArrayBuffer(8),bmp({bytes:[]}),bmp({width:40000001,bytes:[0,0,0,0]})])assert.throws(()=>decodeBmpPixels(bmpCodec,bad));
  assert.equal(decodeBmpPixels(bmpCodec,bmp({bytes:[1,2,3,0]})).width,4);
  console.log('PASS BMP8 palette/RLE8 output, BMP24/32 alpha, palettes 1/4/8, RLE4/8, 16-bit RGB555/565, top-down, corruption and recovery');

  const sizes=[];
  for(const compression of ['none','deflate','lzw'])for(const predictor of [false,true])for(const level of [1,6,9]){
    const buffer=encodeTiffPixels(tiffCodec,image,{tiffCompression:compression,tiffLevel:level,tiffPredictor:predictor});
    const result=decodeTiffPixels(tiffCodec,buffer);assert.equal(result.pages,1);
    assert.deepEqual(new Uint8ClampedArray(result.buffer),image.data,`${compression}/${predictor}/${level}`);
    sizes.push(buffer.byteLength);
    assert.deepEqual(image.data,unchanged,'Encoding must not mutate source pixels');
  }
  assert.ok(new Set(sizes).size>3,'Compression settings affect actual output');
  for(const testImage of [image,{width:17,height:37,data:Uint8ClampedArray.from({length:17*37*4},(_,i)=>i%13<7?42:i*19%256)}]){
    const packed=encodeTiffPixels(tiffCodec,testImage,{tiffCompression:'packbits'});
    const bytes=new DataView(packed),tags=bytes.getUint16(8,true);
    let compressionTag;
    for(let i=0;i<tags;i++)if(bytes.getUint16(10+i*12,true)===259)compressionTag=bytes.getUint16(18+i*12,true);
    assert.equal(compressionTag,32773);
    assert.deepEqual(new Uint8ClampedArray(decodeTiffPixels(tiffCodec,packed).buffer),testImage.data,'PackBits strips preserve RGBA');
  }
  for(const bad of [{tiffCompression:'jpeg'},{tiffLevel:0},{tiffLevel:1.5},{tiffPredictor:1}])assert.throws(()=>normalizeTiffOptions(bad));
  const rgb=[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
  for(const big of [false,true])for(const little of [false,true])for(const planar of [false,true])for(const bits of [8,16]){
    const result=decodeTiffPixels(tiffCodec,tiff({big,little,planar,bits}));
    assert.deepEqual([...new Uint8Array(result.buffer)],rgb,JSON.stringify({big,little,planar,bits}));
  }
  const orientations=[[0,1,2,3],[1,0,3,2],[3,2,1,0],[2,3,0,1],[0,2,1,3],[2,0,3,1],[3,1,2,0],[1,3,0,2]];
  for(let orientation=1;orientation<=8;orientation++)assert.deepEqual([...new Uint8Array(decodeTiffPixels(tiffCodec,tiff({orientation})).buffer)],orientations[orientation-1].flatMap(i=>rgb.slice(i*4,i*4+4)));
  for(const planar of [false,true])for(const bits of [8,16]){
    const result=decodeTiffPixels(tiffCodec,tiff({tiled:true,alpha:true,planar,bits}));
    assert.deepEqual([...new Uint8Array(result.buffer)],rgb.map((v,i)=>i%4===3?Math.floor(i/4)*67:v),'Tiled straight alpha must preserve hidden RGB');
  }
  const rectangle=decodeTiffPixels(tiffCodec,tiff({height:3,orientation:6}));assert.equal(rectangle.width,3);assert.equal(rectangle.height,2);
  for(const bad of [new ArrayBuffer(8),tiff().slice(0,24)])assert.throws(()=>decodeTiffPixels(tiffCodec,bad));
  assert.throws(()=>decodeTiffPixels(tiffCodec,tiff(),1));assert.equal(decodeTiffPixels(tiffCodec,tiff()).width,2);
  console.log('PASS TIFF Deflate/LZW/PackBits settings, exact RGBA, classic/BigTIFF, endian, planar, 16-bit scaling, orientations and corruption');

  const {decodeLegacyTiff}=await import('../src/core/tiff-legacy.mjs');
  const {createJpegDecoder}=await import('../src/core/jpeg.mjs');
  const {installTiffJpeg}=await import('../src/core/tiff-jpeg.mjs');
  const jpeg=await require('../vendor/jpeg-decoder.js')({print(){},printErr(){}});
  const sandbox={console,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView};
  sandbox.self=sandbox;sandbox.window=sandbox;const context=vm.createContext(sandbox);
  for(const name of ['pako-2.1.0.min.js','UPNG-2.1.0.js','UTIF-3.1.0.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor',name),'utf8'),context);
  installTiffJpeg(sandbox.UTIF,createJpegDecoder(jpeg));
  const folder=path.join(__dirname,'fixtures/tiff'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
  for(const item of manifest.cases){
    const buffer=arrayBuffer(fs.readFileSync(path.join(folder,item.file)));let result;
    try{result=decodeTiffPixels(tiffCodec,buffer);}catch{result=decodeLegacyTiff(sandbox.UTIF,buffer);}
    const expected=new Uint8Array(sandbox.UPNG.toRGBA8(sandbox.UPNG.decode(arrayBuffer(fs.readFileSync(path.join(folder,item.expected)))))[0]);
    const actual=new Uint8Array(result.buffer);assert.equal(actual.length,expected.length,item.name);
    let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));assert.ok(max<=1,`${item.name}: difference ${max}`);
  }
  console.log('PASS existing TIFF/JPEG fixtures through libtiff and compatibility fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
