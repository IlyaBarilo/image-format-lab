const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const createCodec=require(process.env.IMAGE_TEST_MODERN_CODEC || '../vendor/modern-codecs.js');

(async()=>{
  const codec=await createCodec({print(){},printErr(){}});
  const width=320,height=192,columns=Math.ceil(width/8),rows=Math.ceil(height/8);
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;
    pixels[at]=(x*3+y*7)%256;
    pixels[at+1]=(x*11+y*2)%256;
    pixels[at+2]=(x*5+y*13)%256;
    pixels[at+3]=255;
  }
  for(const [kind,expectGrid] of [[2,true],[3,false]]){
    const input=codec._malloc(pixels.length);
    try{
      codec.HEAPU8.set(pixels,input);
      assert.equal(codec._viewer_modern_encode(input,pixels.length,width,height,80,kind),0,codec.UTF8ToString(codec._viewer_modern_error()));
      const encoded=codec.HEAPU8.slice(codec._viewer_modern_output(),codec._viewer_modern_output()+codec._viewer_modern_output_size());
      codec._viewer_modern_clear();
      const compressed=codec._malloc(encoded.length);
      try{
        codec.HEAPU8.set(encoded,compressed);
        assert.equal(codec._viewer_modern_decode(compressed,encoded.length,2),0,codec.UTF8ToString(codec._viewer_modern_error()));
        assert.equal(codec._viewer_modern_width(),width);
        assert.equal(codec._viewer_modern_height(),height);
        const count=codec._viewer_modern_block_count();
        assert.equal(count,expectGrid?columns*rows:0,expectGrid?'VarDCT should expose its decoded strategy map':'Modular has no DCT strategy map');
        if(expectGrid){
          const pointer=codec._viewer_modern_block_owners();
          const owners=new Uint32Array(codec.HEAPU8.slice(pointer,pointer+count*4).buffer);
          assert.ok(owners.every(owner=>owner>0&&owner<=count),'every 8×8 cell has a valid decoded owner');
        }
      }finally{codec._viewer_modern_clear();codec._free(compressed);}
    }finally{codec._viewer_modern_clear();codec._free(input);}
    assert.equal(codec._viewer_modern_block_count(),0,'map is released after the decode');
  }
  const messages=[];
  const self={postMessage(message){messages.push(message);}};
  vm.runInNewContext(fs.readFileSync('src/workers/modern.worker.mjs','utf8'),{self,ViewerModernModule:createCodec});
  await self.onmessage({data:{type:'init'}});
  assert.equal(messages.pop().type,'ready');
  for(const [format,expectGrid] of [['jxl',true],['jxlLossless',false]]){
    await self.onmessage({data:{type:'encode',id:1,format,width,height,quality:80,buffer:pixels.slice().buffer}});
    const encoded=messages.pop();
    assert.equal(encoded.type,'encoded');
    await self.onmessage({data:{type:'decode',id:2,format:'jxl',buffer:encoded.buffer}});
    const decoded=messages.pop();
    assert.equal(decoded.type,'decoded');
    assert.equal(decoded.blockOwners?.byteLength||0,expectGrid?columns*rows*4:0);
  }
  console.log('PASS bundled JPEG XL exposes VarDCT strategy regions and omits Modular grid');
})().catch(error=>{console.error(error);process.exitCode=1;});
