

export async function createStoredZip(files) {
  if(files.length>65535)throw new Error("Слишком много файлов для ZIP.");
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c;}
  const parts=[],central=[];let offset=0,centralSize=0;
  for(const file of files) {
    const name=new TextEncoder().encode(file.name);let crc=0xffffffff;
    if(name.length>65535)throw new Error("Слишком длинное имя в ZIP.");
    for(let start=0;start<file.blob.size;start+=1048576){const bytes=new Uint8Array(await file.blob.slice(start,start+1048576).arrayBuffer());for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);await new Promise(resolve=>setTimeout(resolve,0));}
    crc=(crc^0xffffffff)>>>0;
    const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,33,true);
    h.setUint32(14,crc,true);h.setUint32(18,file.blob.size,true);h.setUint32(22,file.blob.size,true);h.setUint16(26,name.length,true);header.set(name,30);
    parts.push(header,file.blob);
    const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,33,true);
    d.setUint32(16,crc,true);d.setUint32(20,file.blob.size,true);d.setUint32(24,file.blob.size,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
    central.push(directory);centralSize+=directory.length;offset+=header.length+file.blob.size;
    if(offset+centralSize>0xffffffff)throw new Error("ZIP превышает допустимый размер.");
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:"application/zip"});
}
