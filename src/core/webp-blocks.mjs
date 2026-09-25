// Inspect only RIFF chunk headers; image and metadata payloads remain untouched.
export async function webpBlockGrid(blob){
  if(!blob||blob.size<20)return null;
  const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const tag=(bytes,start)=>String.fromCharCode(...bytes.subarray(start,start+4));
  if(tag(header,0)!=='RIFF'||tag(header,8)!=='WEBP')return null;
  const size=new DataView(header.buffer).getUint32(4,true)+8;
  if(size!==blob.size)return null;
  let offset=12;
  for(let chunks=0;chunks<64&&offset+8<=size;chunks++){
    const bytes=new Uint8Array(await blob.slice(offset,offset+8).arrayBuffer());
    if(bytes.length!==8)return null;
    const type=tag(bytes,0),length=new DataView(bytes.buffer).getUint32(4,true);
    const end=offset+8+length+(length&1);
    if(end>size||end<=offset)return null;
    if(type==='VP8 ')return {kind:'webp-vp8',width:16,height:16};
    if(type==='VP8L'||type==='ANIM'||type==='ANMF')return null;
    offset=end;
  }
  return null;
}
