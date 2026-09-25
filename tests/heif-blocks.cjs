const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const u16=value=>Buffer.from([(value>>8)&255,value&255]);
const u32=value=>Buffer.from([(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255]);
const box=(type,...parts)=>{
  const body=Buffer.concat(parts);
  return Buffer.concat([u32(body.length+8),Buffer.from(type,'ascii'),body]);
};
const bits=(...fields)=>{
  const sequence=fields.map(([value,count])=>value.toString(2).padStart(count,'0')).join('');
  const padded=sequence.padEnd(Math.ceil(sequence.length/8)*8,'0');
  return Buffer.from(padded.match(/.{8}/g).map(chunk=>parseInt(chunk,2)));
};
const avif=(size,superblock,{transform=false,superres=false,wrongExtent=false}={})=>{
  const [width,height]=size;
  const sequence=bits([0,3],[1,1],[1,1],[0,5],[7,4],[7,4],[width-1,8],[height-1,8],[superblock===128?1:0,1],[0,1],[0,1],[superres?1:0,1]);
  const item=Buffer.concat([Buffer.from([0x0a,sequence.length]),sequence]);
  const ftyp=box('ftyp',Buffer.from('avif\0\0\0\0avif','binary'));
  const ispe=box('ispe',Buffer.alloc(4),u32(width),u32(height));
  const av1C=box('av1C',Buffer.from([0x81,0,0,0]));
  const properties=[ispe,av1C];
  if(transform)properties.push(box('irot',Buffer.from([1])));
  const ipco=box('ipco',...properties);
  const associations=Buffer.from([0,0,0,0,0,0,0,1,0,1,properties.length,1,2,...(transform?[3]:[])]);
  const ipma=box('ipma',associations);
  const iprp=box('iprp',ipco,ipma);
  const pitm=box('pitm',Buffer.alloc(4),u16(1));
  const ilocBody=offset=>Buffer.concat([Buffer.alloc(4),Buffer.from([0x44,0]),u16(1),u16(1),u16(0),u16(1),u32(offset),u32(item.length)]);
  const provisional=box('meta',Buffer.alloc(4),pitm,iprp,box('iloc',ilocBody(0)));
  const itemOffset=ftyp.length+provisional.length+8;
  const meta=box('meta',Buffer.alloc(4),pitm,iprp,box('iloc',ilocBody(wrongExtent?itemOffset+1000:itemOffset)));
  return new Blob([ftyp,meta,box('mdat',item)]);
};

(async()=>{
  const {heifBlockGrid}=await import('../src/core/heif-blocks.mjs');
  for(const step of [64,128]){
    assert.deepEqual(await heifBlockGrid(avif([192,128],step),'avif',192,128),
      {kind:'avif-superblock',width:step,height:step});
  }
  assert.equal(await heifBlockGrid(avif([192,128],64,{transform:true}),'avif',192,128),null);
  assert.equal(await heifBlockGrid(avif([192,128],64,{superres:true}),'avif',192,128),null);
  assert.equal(await heifBlockGrid(avif([192,128],64,{wrongExtent:true}),'avif',192,128),null);
  assert.equal(await heifBlockGrid(avif([192,128],64),'avif',128,192),null);
  const createCodec=require('../vendor/heic-decoder.js');
  const codec=await createCodec({print(){},printErr(){}});
  const pixels=new Uint8Array(192*128*4);
  for(let at=0;at<pixels.length;at+=4){pixels[at]=at%251;pixels[at+1]=83;pixels[at+2]=170;pixels[at+3]=255;}
  const pointer=codec._malloc(pixels.length);
  try{
    codec.HEAPU8.set(pixels,pointer);
    assert.equal(codec._viewer_avif_encode(pointer,pixels.length,192,128,80),0,codec.UTF8ToString(codec._viewer_heic_error()));
    const output=codec.HEAPU8.slice(codec._viewer_heic_output(),codec._viewer_heic_output()+codec._viewer_heic_output_size());
    const result=await heifBlockGrid(new Blob([output]),'avif',192,128);
    assert.ok(result&&result.kind==='avif-superblock'&&[64,128].includes(result.width),'bundled AVIF encoder: '+JSON.stringify(result));
    codec._viewer_heic_clear();
    assert.equal(codec._viewer_heic_encode(pointer,pixels.length,192,128,80),0,codec.UTF8ToString(codec._viewer_heic_error()));
    const heic=codec.HEAPU8.slice(codec._viewer_heic_output(),codec._viewer_heic_output()+codec._viewer_heic_output_size());
    const ctu=await heifBlockGrid(new Blob([heic]),'heic',192,128);
    assert.ok(ctu&&ctu.kind==='heic-ctu'&&[16,32,64].includes(ctu.width),'bundled HEIC encoder: '+JSON.stringify(ctu));
    for(const format of ['avif','heic']){
      codec._viewer_heic_clear();
      const resultCode=(format==='avif'?codec._viewer_avif_encode:codec._viewer_heic_encode)(pointer,129*65*4,129,65,80);
      assert.equal(resultCode,0,codec.UTF8ToString(codec._viewer_heic_error()));
      const odd=codec.HEAPU8.slice(codec._viewer_heic_output(),codec._viewer_heic_output()+codec._viewer_heic_output_size());
      assert.ok(await heifBlockGrid(new Blob([odd]),format,129,65),format+' odd dimensions retain the encoded grid origin');
      if(format==='heic'){
        const shifted=Buffer.from(odd),clap=shifted.indexOf('clap');
        assert.ok(clap>0);
        shifted.writeInt32BE(0,clap+20);
        assert.equal(await heifBlockGrid(new Blob([shifted]),format,129,65),null,'offset crop cannot use a grid anchored at zero');
      }
    }
  }finally{codec._viewer_heic_clear();codec._free(pointer);}
  const folder=path.join(__dirname,'fixtures','heic');
  for(const [name,width,height] of [['rgb8',96,64],['alpha8',96,64],['rgb10',96,64],['primary-second',96,64],['large',2048,1536]]){
    const result=await heifBlockGrid(new Blob([fs.readFileSync(path.join(folder,name+'.heic'))]),'heic',width,height);
    assert.ok(result&&result.kind==='heic-ctu'&&[16,32,64].includes(result.width),name+': '+JSON.stringify(result));
  }
  for(const [name,width,height] of [['rotate90',64,96],['mirror',96,64],['grid',128,96]]){
    assert.equal(await heifBlockGrid(new Blob([fs.readFileSync(path.join(folder,name+'.heic'))]),'heic',width,height),null,name);
  }
  console.log('PASS exact AVIF/HEIC top-level block sizes, primary items and unsupported layouts');
})().catch(error=>{console.error(error);process.exitCode=1;});
