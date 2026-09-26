const assert=require('node:assert/strict');
const pako=require('../vendor/pako-2.1.0.min.js');

(async()=>{
  const {encodeTiff16,decodeTiff16}=await import('../src/core/tiff16.mjs');
  const width=17,height=9,data=new Uint16Array(width*height*4);
  for(let i=0;i<data.length;i++)data[i]=i%4===3?65535:(i*1009+123)&65535;
  data[0]=1;data[1]=256;data[2]=65534;data[3]=32769;
  const pixels={width,height,data,sampleType:'uint16',bitDepth:16};
  for(const compression of ['none','deflate'])for(const predictor of [false,true]){
    const options={tiffCompression:compression,tiffLevel:6,tiffPredictor:predictor};
    const bytes=encodeTiff16(pixels,options,pako);
    const decoded=decodeTiff16(bytes,0,pako);
    assert.deepEqual(decoded.data,data,`${compression}, predictor ${predictor}`);
    const v=new DataView(bytes);
    assert.equal(v.getUint16(2,true),42);
    const count=v.getUint16(8,true),tags=new Map();
    for(let i=0;i<count;i++){const at=10+i*12;tags.set(v.getUint16(at,true),at);}
    assert.equal(v.getUint16(tags.get(258)+4,true),4);
    assert.equal(v.getUint16(v.getUint32(tags.get(258)+8,true),true),16);
    assert.equal(v.getUint16(tags.get(259)+8,true),compression==='deflate'?8:1);
    assert.equal(v.getUint16(tags.get(338)+8,true),2);
    const offset=v.getUint32(tags.get(273)+8,true),length=v.getUint32(tags.get(279)+8,true);
    const packed=new Uint8Array(bytes,offset,length);
    const raw=compression==='deflate'?pako.inflate(packed):packed;
    assert.equal(raw.length,data.byteLength);
    assert.equal(new DataView(raw.buffer,raw.byteOffset).getUint16(0,true),data[0]);
    assert.throws(()=>encodeTiff16(pixels,{...options,tiffCompression:'lzw'},pako),/Deflate/);
  }
  const upsampled=decodeTiff16(encodeTiff16({width:1,height:1,data:new Uint8Array([1,128,255,255]),sampleType:'uint8',bitDepth:8},{tiffCompression:'none'},pako),0,pako);
  assert.deepEqual([...upsampled.data],[257,32896,65535,65535]);
  const file=encodeTiff16(pixels,{tiffCompression:'deflate',tiffPredictor:true},pako);
  const damaged=file.slice(0),view=new DataView(damaged);
  const entries=view.getUint16(8,true);
  for(let i=0;i<entries;i++){const at=10+i*12;if(view.getUint16(at,true)===259)view.setUint16(at+8,5,true);}
  assert.equal(decodeTiff16(damaged,0,pako).fallback,true);
  const big=new ArrayBuffer(52),bigView=new DataView(big);
  bigView.setUint16(0,0x4949,true);bigView.setUint16(2,43,true);
  bigView.setUint16(4,8,true);bigView.setBigUint64(8,16n,true);
  bigView.setBigUint64(16,1n,true);bigView.setUint16(24,258,true);
  bigView.setUint16(26,3,true);bigView.setBigUint64(28,1n,true);
  bigView.setUint16(36,16,true);
  assert.equal(decodeTiff16(big,0,pako).fallback,true);
  // Independent big-endian grayscale fixture, including a PackBits strip.
  function gray16(value,compression=1,whiteIsZero=false){
    const payload=compression===1?[value>>8,value&255]:[1,value>>8,value&255];
    const bytes=new ArrayBuffer(134+payload.length),v=new DataView(bytes);
    v.setUint16(0,0x4d4d,false);v.setUint16(2,42,false);v.setUint32(4,8,false);v.setUint16(8,10,false);
    const tags=[[256,4,1,1],[257,4,1,1],[258,3,1,16],[259,3,1,compression],[262,3,1,whiteIsZero?0:1],
      [273,4,1,134],[277,3,1,1],[278,4,1,1],[279,4,1,payload.length],[284,3,1,1]];
    tags.forEach(([tag,type,count,entry],i)=>{const at=10+i*12;v.setUint16(at,tag,false);v.setUint16(at+2,type,false);v.setUint32(at+4,count,false);
      if(type===3)v.setUint16(at+8,entry,false);else v.setUint32(at+8,entry,false);});
    new Uint8Array(bytes).set(payload,134);return bytes;
  }
  assert.deepEqual([...decodeTiff16(gray16(0x1234),0,pako).data],[0x1234,0x1234,0x1234,65535]);
  assert.deepEqual([...decodeTiff16(gray16(0x1234,32773,true),0,pako).data],[0xedcb,0xedcb,0xedcb,65535]);
  assert.equal(decodeTiff16(new Uint8Array([1,2,3,4,5,6,7,8]).buffer,0,pako),null);
  console.log('PASS exact TIFF16 low bits, tags, Deflate, predictor and explicit rejection');
})().catch(error=>{console.error(error);process.exitCode=1;});
