/* Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE. */
#include <tiffio.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdarg.h>
#define LIMIT 268435456u
typedef struct {uint8_t *data;size_t size,pos,capacity;int writable;} memory_file;
static uint8_t *output;static size_t output_size;static uint32_t width,height,pages;static char error[512];
void viewer_tiff_clear(void){free(output);output=NULL;output_size=0;width=height=pages=0;error[0]=0;}
uint8_t *viewer_tiff_pixels(void){return output;}
size_t viewer_tiff_bytes(void){return output_size;}
int viewer_tiff_width(void){return width;}
int viewer_tiff_height(void){return height;}
int viewer_tiff_pages(void){return pages;}
const char *viewer_tiff_error(void){return error;}
static int fail(const char *s){snprintf(error,sizeof(error),"%s",s);return 1;}
static int message(TIFF *t,void *u,const char *m,const char *fmt,va_list args){(void)t;(void)u;(void)m;vsnprintf(error,sizeof(error),fmt,args);return 1;}
static int warning(TIFF *t,void *u,const char *m,const char *fmt,va_list args){return 1;}
static tmsize_t read_mem(thandle_t h,void *out,tmsize_t n){memory_file*f=h;if(n<0||f->pos>f->size)return 0;size_t amount=(size_t)n;if(amount>f->size-f->pos)amount=f->size-f->pos;memcpy(out,f->data+f->pos,amount);f->pos+=amount;return amount;}
static tmsize_t write_mem(thandle_t h,void *in,tmsize_t n){
 memory_file*f=h;if(!f->writable||n<0||f->pos>LIMIT||(size_t)n>LIMIT-f->pos)return 0;
 size_t end=f->pos+n;if(end>f->capacity){size_t cap=end+end/2+4096;if(cap>LIMIT)cap=LIMIT;uint8_t*p=realloc(f->data,cap);if(!p)return 0;memset(p+f->capacity,0,cap-f->capacity);f->data=p;f->capacity=cap;}
 memcpy(f->data+f->pos,in,n);f->pos=end;if(end>f->size)f->size=end;return n;
}
static toff_t seek_mem(thandle_t h,toff_t off,int origin){memory_file*f=h;int64_t base=origin==SEEK_SET?0:origin==SEEK_CUR?(int64_t)f->pos:origin==SEEK_END?(int64_t)f->size:-1;if(base<0)return (toff_t)-1;int64_t step=(int64_t)off;if(step>LIMIT||step<-(int64_t)LIMIT)return (toff_t)-1;int64_t pos=base+step;if(pos<0||pos>LIMIT||(!f->writable&&(uint64_t)pos>f->size))return (toff_t)-1;f->pos=(size_t)pos;return f->pos;}
static int close_mem(thandle_t h){return 0;}
static toff_t size_mem(thandle_t h){return ((memory_file*)h)->size;}
static int map_mem(thandle_t h,void **base,toff_t*size){return 0;}
static void unmap_mem(thandle_t h,void*base,toff_t size){}
static TIFF *open_mem(memory_file *f,const char *mode){
 TIFFOpenOptions*o=TIFFOpenOptionsAlloc();if(!o)return NULL;
 TIFFOpenOptionsSetMaxSingleMemAlloc(o,160000000);TIFFOpenOptionsSetMaxCumulatedMemAlloc(o,LIMIT);
 TIFFOpenOptionsSetErrorHandlerExtR(o,message,NULL);TIFFOpenOptionsSetWarningHandlerExtR(o,warning,NULL);
 TIFF*t=TIFFClientOpenExt("image",mode,f,read_mem,write_mem,seek_mem,close_mem,size_mem,map_mem,unmap_mem,o);TIFFOpenOptionsFree(o);return t;
}
static uint8_t straight(uint8_t v,uint8_t a){if(!a)return 0;unsigned out=((unsigned)v*255+a/2)/a;return out>255?255:out;}
int viewer_tiff_decode(uint8_t *input,size_t length,unsigned page){
 viewer_tiff_clear();if(!input||length<8||length>LIMIT)return fail("Invalid TIFF size");
 memory_file file={input,length,0,length,0};TIFF*t=open_mem(&file,"r");if(!t)return 1;
 int result=1;uint8_t*scan=NULL;uint32_t*raster=NULL;uint16_t bits=0,spp=0,photo=0,planar=0,orientation=1,format=1,extraCount=0,*extras=NULL;
 do{if(++pages>256){fail("TIFF has more than 256 directories");goto done;}}while(TIFFReadDirectory(t));
 if(page>=pages||!TIFFSetDirectory(t,page)){fail("Invalid TIFF page");goto done;}
 TIFFGetField(t,TIFFTAG_IMAGEWIDTH,&width);TIFFGetField(t,TIFFTAG_IMAGELENGTH,&height);
 if(!width||!height||(uint64_t)width*height>40000000){fail("TIFF exceeds 40 megapixels");goto done;}
 TIFFGetFieldDefaulted(t,TIFFTAG_BITSPERSAMPLE,&bits);TIFFGetFieldDefaulted(t,TIFFTAG_SAMPLESPERPIXEL,&spp);TIFFGetFieldDefaulted(t,TIFFTAG_PHOTOMETRIC,&photo);TIFFGetFieldDefaulted(t,TIFFTAG_PLANARCONFIG,&planar);TIFFGetFieldDefaulted(t,TIFFTAG_ORIENTATION,&orientation);TIFFGetFieldDefaulted(t,TIFFTAG_SAMPLEFORMAT,&format);TIFFGetField(t,TIFFTAG_EXTRASAMPLES,&extraCount,&extras);
 if(orientation<1||orientation>8){fail("Invalid TIFF orientation");goto done;}
 output_size=(size_t)width*height*4;output=calloc(1,output_size);if(!output){fail("Cannot allocate TIFF pixels");goto done;}
 unsigned colors=photo==PHOTOMETRIC_RGB?3:1;
 int direct=format==SAMPLEFORMAT_UINT&&(bits==8||bits==16)&&(photo==PHOTOMETRIC_RGB||photo==PHOTOMETRIC_MINISBLACK||photo==PHOTOMETRIC_MINISWHITE)&&(spp==colors||spp==colors+1);
 if(direct){
  int tiled=TIFFIsTiled(t);uint32_t blockWidth=width,blockHeight=1;
  if(tiled){TIFFGetField(t,TIFFTAG_TILEWIDTH,&blockWidth);TIFFGetField(t,TIFFTAG_TILELENGTH,&blockHeight);}
  if(!blockWidth||!blockHeight){fail("Invalid TIFF tile dimensions");goto done;}
  uint64_t bytes=tiled?TIFFTileSize64(t):TIFFScanlineSize64(t),rowBytes=(uint64_t)blockWidth*(planar==PLANARCONFIG_SEPARATE?1:spp)*(bits/8);
  if(!rowBytes||rowBytes>160000000||blockHeight>160000000/rowBytes||bytes<rowBytes*blockHeight||bytes>160000000){fail("Invalid TIFF block size");goto done;}
  scan=malloc(bytes);if(!scan){fail("Cannot allocate TIFF scanline");goto done;}
  for(size_t p=0;p<(size_t)width*height;p++)output[p*4+3]=255;
  for(unsigned plane=0;plane<(planar==PLANARCONFIG_SEPARATE?spp:1);plane++)for(uint32_t by=0;by<height;by+=blockHeight)for(uint32_t bx=0;bx<width;bx+=blockWidth){
   if(tiled){if(TIFFReadEncodedTile(t,TIFFComputeTile(t,bx,by,0,plane),scan,bytes)<(tmsize_t)(rowBytes*blockHeight))goto done;}
   else if(TIFFReadScanline(t,scan,by,plane)<0)goto done;
   for(uint32_t y=0;y<blockHeight&&y<height-by;y++)for(uint32_t x=0;x<blockWidth&&x<width-bx;x++)for(unsigned c=0;c<(planar==PLANARCONFIG_SEPARATE?1:spp);c++){
    unsigned channel=planar==PLANARCONFIG_SEPARATE?plane:c;size_t at=((size_t)y*blockWidth+x)*(planar==PLANARCONFIG_SEPARATE?1:spp)+c;unsigned value=bits==8?scan[at]:(((uint16_t*)scan)[at]+128)/257;
    uint8_t*pixel=output+((size_t)(by+y)*width+bx+x)*4;
    if(channel<colors){if(photo==PHOTOMETRIC_MINISWHITE)value=255-value;if(colors==1)pixel[0]=pixel[1]=pixel[2]=value;else pixel[channel]=value;}
    else if(extraCount==1&&(extras[0]==EXTRASAMPLE_ASSOCALPHA||extras[0]==EXTRASAMPLE_UNASSALPHA))pixel[3]=value;
   }
  }
  if(extraCount==1&&extras[0]==EXTRASAMPLE_ASSOCALPHA)for(size_t p=0;p<output_size;p+=4)for(int c=0;c<3;c++)output[p+c]=straight(output[p+c],output[p+3]);
 }else{
  raster=malloc(output_size);if(!raster){fail("Cannot allocate TIFF raster");goto done;}
  // Ask libtiff for storage order, then apply all eight orientations below.
  TIFFSetField(t,TIFFTAG_ORIENTATION,ORIENTATION_TOPLEFT);
  if(!TIFFReadRGBAImageOriented(t,width,height,raster,ORIENTATION_TOPLEFT,1))goto done;
  for(size_t i=0;i<(size_t)width*height;i++){uint32_t v=raster[i];uint8_t a=TIFFGetA(v);output[i*4]=straight(TIFFGetR(v),a);output[i*4+1]=straight(TIFFGetG(v),a);output[i*4+2]=straight(TIFFGetB(v),a);output[i*4+3]=a;}
 }
 if(orientation!=1){
  uint32_t ow=orientation>=5?height:width,oh=orientation>=5?width:height;uint8_t*oriented=malloc(output_size);if(!oriented){fail("Cannot orient TIFF");goto done;}
  for(uint32_t y=0;y<height;y++)for(uint32_t x=0;x<width;x++){
   uint32_t dx=x,dy=y;
   switch(orientation){case 2:dx=width-1-x;break;case 3:dx=width-1-x;dy=height-1-y;break;case 4:dy=height-1-y;break;case 5:dx=y;dy=x;break;case 6:dx=height-1-y;dy=x;break;case 7:dx=height-1-y;dy=width-1-x;break;case 8:dx=y;dy=width-1-x;break;}
   memcpy(oriented+((size_t)dy*ow+dx)*4,output+((size_t)y*width+x)*4,4);
  }free(output);output=oriented;width=ow;height=oh;
 }
 result=0;
 done: free(scan);free(raster);TIFFClose(t);if(result){free(output);output=NULL;output_size=0;if(!error[0])fail("Unsupported or damaged TIFF");}return result;
}
int viewer_tiff_encode(uint8_t *input,int w,int h,int compression,int level,int predictor){
 viewer_tiff_clear();if(!input||w<=0||h<=0||(uint64_t)w*h>40000000||(compression!=1&&compression!=5&&compression!=8)||level<1||level>9||(predictor!=1&&predictor!=2))return fail("Invalid TIFF encoding settings");
 memory_file file={0};file.writable=1;TIFF*t=open_mem(&file,"w");if(!t)return 1;int result=1;uint16_t alpha=EXTRASAMPLE_UNASSALPHA;
 if(!TIFFSetField(t,TIFFTAG_IMAGEWIDTH,w)||!TIFFSetField(t,TIFFTAG_IMAGELENGTH,h)||!TIFFSetField(t,TIFFTAG_BITSPERSAMPLE,8)||!TIFFSetField(t,TIFFTAG_SAMPLESPERPIXEL,4)||!TIFFSetField(t,TIFFTAG_PHOTOMETRIC,PHOTOMETRIC_RGB)||!TIFFSetField(t,TIFFTAG_PLANARCONFIG,PLANARCONFIG_CONTIG)||!TIFFSetField(t,TIFFTAG_EXTRASAMPLES,1,&alpha)||!TIFFSetField(t,TIFFTAG_COMPRESSION,compression)||!TIFFSetField(t,TIFFTAG_ROWSPERSTRIP,TIFFDefaultStripSize(t,0)))goto done;
 if(compression!=1&&!TIFFSetField(t,TIFFTAG_PREDICTOR,predictor))goto done;
 if(compression==8&&!TIFFSetField(t,TIFFTAG_ZIPQUALITY,level))goto done;
 for(int y=0;y<h;y++)if(TIFFWriteScanline(t,input+(size_t)y*w*4,y,0)<0)goto done;
 if(!TIFFWriteDirectory(t))goto done;result=0;
 done:TIFFClose(t);if(result){free(file.data);if(!error[0])fail("TIFF encoding failed");}else{output=file.data;output_size=file.size;width=w;height=h;}return result;
}
