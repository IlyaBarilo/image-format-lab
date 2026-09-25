// Read only the primary coded item's geometry. Unsupported HEIF layouts return no grid.
const MAX_META_BYTES=4*1024*1024;
const MAX_ITEM_PREFIX=256*1024;

function number(bytes,at,size){
  if(!Number.isInteger(size)||size<0||size>8||at<0||at+size>bytes.length)throw Error('HEIF field out of bounds');
  let value=0;
  for(let i=0;i<size;i++)value=value*256+bytes[at+i];
  if(!Number.isSafeInteger(value))throw Error('HEIF field too large');
  return value;
}

function boxAt(bytes,at,end){
  if(at+8>end)return null;
  let size=number(bytes,at,4),header=8;
  if(size===1){size=number(bytes,at+8,8);header=16;}
  else if(size===0)size=end-at;
  if(size<header||at+size>end)return null;
  return {type:String.fromCharCode(...bytes.subarray(at+4,at+8)),start:at,body:at+header,end:at+size};
}

function childBoxes(bytes,start,end){
  const result=[];
  for(let at=start;at<end;){
    if(result.length>=4096)throw Error('Too many HEIF boxes');
    const box=boxAt(bytes,at,end);
    if(!box)throw Error('Invalid HEIF box');
    result.push(box);at=box.end;
  }
  return result;
}

function fullVersion(bytes,box){return number(bytes,box.body,1);}

function apertureMatches(bytes,property,codedWidth,codedHeight,displayWidth,displayHeight){
  if(!property)return codedWidth===displayWidth&&codedHeight===displayHeight;
  if(property.end-property.body!==32)return false;
  const fields=[];
  for(let at=property.body;at<property.end;at+=4)fields.push(number(bytes,at,4));
  const [widthN,widthD,heightN,heightD,horizontalN,horizontalD,verticalN,verticalD]=fields;
  if(!widthD||!heightD||!horizontalD||!verticalD||
     widthN!==displayWidth*widthD||heightN!==displayHeight*heightD||
     displayWidth>codedWidth||displayHeight>codedHeight)return false;
  const signed=value=>BigInt(value>=0x80000000?value-0x100000000:value);
  return BigInt(codedWidth-displayWidth)*BigInt(horizontalD)+2n*signed(horizontalN)===0n&&
    BigInt(codedHeight-displayHeight)*BigInt(verticalD)+2n*signed(verticalN)===0n;
}

function primaryId(bytes,box){
  const version=fullVersion(bytes,box);
  if(version>1)throw Error('Unsupported pitm');
  return number(bytes,box.body+4,version?4:2);
}

function itemProperties(bytes,iprp,id){
  const children=childBoxes(bytes,iprp.body,iprp.end);
  const ipco=children.find(box=>box.type==='ipco');
  if(!ipco)return null;
  const properties=childBoxes(bytes,ipco.body,ipco.end);
  const indices=[];
  for(const box of children.filter(box=>box.type==='ipma')){
    const version=fullVersion(bytes,box),flags=number(bytes,box.body+1,3);
    if(version>1)throw Error('Unsupported ipma');
    let at=box.body+4;
    const entries=number(bytes,at,4);at+=4;
    if(entries>4096)throw Error('Too many HEIF items');
    for(let entry=0;entry<entries;entry++){
      const item=number(bytes,at,version?4:2);at+=version?4:2;
      const count=number(bytes,at,1);at++;
      for(let i=0;i<count;i++){
        const wide=Boolean(flags&1),association=number(bytes,at,wide?2:1);
        at+=wide?2:1;
        const index=association&(wide?0x7fff:0x7f);
        if(item===id&&index)indices.push(index);
      }
    }
    if(at!==box.end)throw Error('Invalid ipma length');
  }
  if(!indices.length)return null;
  const selected=indices.map(index=>properties[index-1]);
  if(selected.some(property=>!property))return null;
  return selected;
}

function location(bytes,iloc,id){
  const version=fullVersion(bytes,iloc);
  if(version>2)throw Error('Unsupported iloc');
  let at=iloc.body+4;
  const sizes=number(bytes,at,1),other=number(bytes,at+1,1);at+=2;
  const offsetSize=sizes>>4,lengthSize=sizes&15,baseSize=other>>4,indexSize=version?other&15:0;
  if([offsetSize,lengthSize,baseSize,indexSize].some(size=>size>8))throw Error('Unsupported iloc field');
  const count=number(bytes,at,version===2?4:2);at+=version===2?4:2;
  if(count>4096)throw Error('Too many HEIF locations');
  for(let i=0;i<count;i++){
    const item=number(bytes,at,version===2?4:2);at+=version===2?4:2;
    const method=version?number(bytes,at,2)&15:0;if(version)at+=2;
    const reference=number(bytes,at,2);at+=2;
    const base=number(bytes,at,baseSize);at+=baseSize;
    const extentCount=number(bytes,at,2);at+=2;
    if(extentCount>4096)throw Error('Too many HEIF extents');
    const extents=[];
    for(let j=0;j<extentCount;j++){
      if(indexSize)at+=indexSize;
      const offset=number(bytes,at,offsetSize);at+=offsetSize;
      const length=number(bytes,at,lengthSize);at+=lengthSize;
      if(item===id)extents.push({offset:base+offset,length});
    }
    if(at>iloc.end)throw Error('Invalid iloc length');
    if(item===id)return reference===0&&method===0&&extents.length?extents:null;
  }
  return null;
}

class Bits{
  constructor(bytes){this.bytes=bytes;this.pos=0;}
  read(count){
    if(count<0||count>32||this.pos+count>this.bytes.length*8)throw Error('Truncated codec header');
    let value=0;
    for(let i=0;i<count;i++)value=value*2+((this.bytes[this.pos>>3]>>(7-(this.pos&7)))&1),this.pos++;
    return value;
  }
  ue(){
    let zeros=0;
    while(!this.read(1)){if(++zeros>30)throw Error('Invalid Exp-Golomb number');}
    return 2**zeros-1+(zeros?this.read(zeros):0);
  }
}

function hevcSps(bytes){
  if(bytes.length<4||((bytes[0]>>1)&63)!==33)return null;
  const rbsp=[];
  for(let i=2;i<bytes.length;i++){
    if(i>=4&&bytes[i]===3&&bytes[i-1]===0&&bytes[i-2]===0)continue;
    rbsp.push(bytes[i]);
  }
  const bits=new Bits(rbsp);
  bits.read(4);const layers=bits.read(3);bits.read(1);
  bits.read(2);bits.read(1);bits.read(5);bits.read(32);bits.read(32);bits.read(16);bits.read(8);
  const profile=[],level=[];
  for(let i=0;i<layers;i++){profile.push(bits.read(1));level.push(bits.read(1));}
  if(layers)bits.read((8-layers)*2);
  for(let i=0;i<layers;i++){if(profile[i]){bits.read(32);bits.read(32);bits.read(24);}if(level[i])bits.read(8);}
  bits.ue();let chroma=bits.ue();let separate=0;
  if(chroma>3)return null;
  if(chroma===3)separate=bits.read(1);
  const codedWidth=bits.ue(),codedHeight=bits.ue();
  let left=0,right=0,top=0,bottom=0;
  if(bits.read(1)){left=bits.ue();right=bits.ue();top=bits.ue();bottom=bits.ue();}
  const subWidth=chroma===1||chroma===2&&!separate?2:1;
  const subHeight=chroma===1&&!separate?2:1;
  const width=codedWidth-(left+right)*subWidth,height=codedHeight-(top+bottom)*subHeight;
  bits.ue();bits.ue();bits.ue();
  const allLayers=bits.read(1);
  for(let i=allLayers?0:layers;i<=layers;i++){bits.ue();bits.ue();bits.ue();}
  const min=bits.ue(),diff=bits.ue(),step=2**(min+diff+3);
  if(![16,32,64].includes(step)||left||top||width<1||height<1)return null;
  return {step,width,height};
}

function hevcConfig(bytes,property){
  let at=property.body;
  if(number(bytes,at,1)!==1||property.end-at<23)return null;
  const arrays=number(bytes,at+22,1);at+=23;
  for(let i=0;i<arrays;i++){
    if(at+3>property.end)throw Error('Invalid hvcC array');
    const type=number(bytes,at,1)&63,count=number(bytes,at+1,2);at+=3;
    for(let j=0;j<count;j++){
      if(at+2>property.end)throw Error('Invalid hvcC NAL length');
      const length=number(bytes,at,2);at+=2;
      if(at+length>property.end)throw Error('Invalid hvcC NAL');
      if(type===33){const parsed=hevcSps(bytes.subarray(at,at+length));if(parsed)return parsed;}
      at+=length;
    }
  }
  return null;
}

function av1Sequence(bytes){
  const bits=new Bits(bytes);
  bits.read(3);bits.read(1);const reduced=bits.read(1);
  if(reduced)bits.read(5);
  else{
    let delayLength=0;
    if(bits.read(1)){
      bits.read(32);bits.read(32);
      if(bits.read(1))bits.ue();
      if(bits.read(1)){delayLength=bits.read(5)+1;bits.read(32);bits.read(5);bits.read(5);}
    }
    const initialDelay=bits.read(1),points=bits.read(5)+1;
    for(let i=0;i<points;i++){
      bits.read(12);const level=bits.read(5);if(level>7)bits.read(1);
      if(delayLength&&bits.read(1)){bits.read(delayLength);bits.read(delayLength);bits.read(1);}
      if(initialDelay&&bits.read(1))bits.read(4);
    }
  }
  const widthBits=bits.read(4)+1,heightBits=bits.read(4)+1;
  const width=bits.read(widthBits)+1,height=bits.read(heightBits)+1;
  if(!reduced&&bits.read(1)){bits.read(4);bits.read(3);}
  const step=bits.read(1)?128:64;
  bits.read(1);bits.read(1);
  if(!reduced){
    bits.read(4);const orderHint=bits.read(1);
    if(orderHint){bits.read(1);bits.read(1);}
    if(!bits.read(1))bits.read(1);
    // The remaining flags are not needed: reject non-reduced headers until
    // frame scaling and render-size validation are available.
    return null;
  }
  // reduced_still_picture_header still permits super-resolution; do not claim
  // displayed pixel coordinates when that tool can be enabled.
  if(bits.read(1))return null;
  return {step,width,height};
}

function av1Obus(bytes){
  for(let at=0;at<bytes.length;){
    const header=bytes[at++];
    if(header&0x81)return null;
    const type=(header>>3)&15,extension=Boolean(header&4),sized=Boolean(header&2);
    if(extension){if(at>=bytes.length)return null;at++;}
    let length=bytes.length-at;
    if(sized){
      length=0;let shift=0,done=false;
      for(let i=0;i<8;i++){
        if(at>=bytes.length)return null;
        const value=bytes[at++];length+=(value&127)*2**shift;shift+=7;
        if(!(value&128)){done=true;break;}
      }
      if(!done||!Number.isSafeInteger(length))return null;
    }
    if(at+length>bytes.length)return null;
    if(type===1)return av1Sequence(bytes.subarray(at,at+length));
    at+=length;
  }
  return null;
}

async function metaBox(blob){
  for(let at=0,count=0;at<blob.size&&count++<128;){
    const head=new Uint8Array(await blob.slice(at,at+16).arrayBuffer());
    if(head.length<8)return null;
    let size=number(head,0,4),header=8;
    if(size===1){if(head.length<16)return null;size=number(head,8,8);header=16;}
    else if(size===0)size=blob.size-at;
    if(size<header||size>blob.size-at)return null;
    if(String.fromCharCode(...head.subarray(4,8))==='meta'){
      if(size>MAX_META_BYTES)return null;
      return {offset:at,bytes:new Uint8Array(await blob.slice(at,at+size).arrayBuffer())};
    }
    at+=size;
  }
  return null;
}

export async function heifBlockGrid(blob,format,displayWidth,displayHeight){
  if(!blob||!['avif','heic'].includes(format)||!Number.isInteger(displayWidth)||!Number.isInteger(displayHeight)||
     displayWidth<1||displayHeight<1)return null;
  try{
    const found=await metaBox(blob);if(!found)return null;
    const {bytes}=found,meta=boxAt(bytes,0,bytes.length);
    if(!meta||meta.type!=='meta')return null;
    const children=childBoxes(bytes,meta.body+4,meta.end);
    const pitm=children.find(box=>box.type==='pitm'),iprp=children.find(box=>box.type==='iprp');
    if(!pitm||!iprp)return null;
    const id=primaryId(bytes,pitm),properties=itemProperties(bytes,iprp,id);
    if(!properties||properties.some(box=>['irot','imir'].includes(box.type)))return null;
    const dimensions=properties.filter(box=>box.type==='ispe');
    const config=properties.filter(box=>box.type===(format==='heic'?'hvcC':'av1C'));
    const apertures=properties.filter(box=>box.type==='clap');
    if(dimensions.length!==1||config.length!==1||apertures.length>1)return null;
    const ispe=dimensions[0],width=number(bytes,ispe.body+4,4),height=number(bytes,ispe.body+8,4);
    if(!width||!height)return null;
    if(!apertureMatches(bytes,apertures[0],width,height,displayWidth,displayHeight))return null;
    if(format==='heic'){
      const grid=hevcConfig(bytes,config[0]);
      return grid&&grid.width===width&&grid.height===height?{kind:'heic-ctu',width:grid.step,height:grid.step}:null;
    }
    const iloc=children.find(box=>box.type==='iloc');if(!iloc)return null;
    const extents=location(bytes,iloc,id);if(!extents)return null;
    let total=0;const parts=[];
    for(const extent of extents){
      if(extent.length<1||extent.offset<0||extent.offset+extent.length>blob.size)return null;
      const length=Math.min(extent.length,MAX_ITEM_PREFIX-total);
      if(!length)break;
      parts.push(new Uint8Array(await blob.slice(extent.offset,extent.offset+length).arrayBuffer()));total+=length;
    }
    const item=new Uint8Array(total);let at=0;
    for(const part of parts){item.set(part,at);at+=part.length;}
    const grid=av1Obus(item);
    return grid&&grid.width===width&&grid.height===height?{kind:'avif-superblock',width:grid.step,height:grid.step}:null;
  }catch{return null;}
}
