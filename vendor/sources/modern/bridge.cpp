// Copyright (c) 2026 Ilya Barilo. MIT. Third-party APIs retain their licenses.
#include <jxl/decode.h>
#include <jxl/encode.h>
#include <jxl/color_encoding.h>
#include <webp/encode.h>
#include <webp/decode.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>
namespace {
std::vector<uint8_t> output;
std::vector<uint32_t> block_owners;
int width=0,height=0;
char error[256]={};
constexpr size_t limit=256u*1024*1024;
int fail(const char* text) { std::snprintf(error,sizeof(error),"%s",text);return 1; }
bool dimensions(int w,int h) {return w>0 && h>0 && uint64_t(w)*h<=40000000;}
}
extern "C" size_t viewer_jxl_block_map(JxlDecoder*, uint32_t*, size_t,
                                        uint32_t, uint32_t);
extern "C" {
void viewer_modern_clear() {std::vector<uint8_t>().swap(output);std::vector<uint32_t>().swap(block_owners);width=height=0;error[0]=0;}
const char* viewer_modern_error(){return error;}
const uint8_t* viewer_modern_output(){return output.data();}
size_t viewer_modern_output_size(){return output.size();}
int viewer_modern_width(){return width;}
int viewer_modern_height(){return height;}
const uint32_t* viewer_modern_block_owners(){return block_owners.data();}
size_t viewer_modern_block_count(){return block_owners.size();}
// kind: 1 WebP lossless, 2 JPEG XL lossy, 3 JPEG XL lossless.
int viewer_modern_encode(const uint8_t* rgba,size_t length,int w,int h,int quality,int kind,int webp_method,int jxl_effort) {
 viewer_modern_clear();
 if (!rgba || !dimensions(w,h) || length!=size_t(w)*h*4 || quality<1 || quality>100 || kind<1 || kind>3 || webp_method<0 || webp_method>6 || jxl_effort<1 || jxl_effort>10) return fail("Invalid image or encoder options; limit 40 megapixels");
 if (kind==1) {
  if(w>16383 || h>16383) return fail("WebP dimensions exceed 16383 pixels");
  WebPConfig config;WebPPicture picture;
  if(!WebPConfigInit(&config) || !WebPPictureInit(&picture)) return fail("WebP ABI mismatch");
  config.lossless=1;config.quality=100;config.method=webp_method;config.exact=1;config.thread_level=0;
  picture.use_argb=1;picture.width=w;picture.height=h;
  picture.custom_ptr=&output;
  picture.writer=[](const uint8_t* data,size_t size,const WebPPicture* p)->int {
   auto& bytes=*static_cast<std::vector<uint8_t>*>(p->custom_ptr);
   if(size>limit-bytes.size()) return 0;
   bytes.insert(bytes.end(),data,data+size);return 1;
  };
  bool ok=WebPValidateConfig(&config) && WebPPictureImportRGBA(&picture,rgba,w*4) && WebPEncode(&config,&picture);
  WebPPictureFree(&picture);
  if(!ok) return fail("WebP encoding failed");
 } else {
  std::unique_ptr<JxlEncoder,decltype(&JxlEncoderDestroy)> enc(JxlEncoderCreate(nullptr),JxlEncoderDestroy);
  if(!enc) return fail("Cannot allocate JPEG XL encoder");
  const bool lossless=kind==3;
  JxlBasicInfo info;JxlEncoderInitBasicInfo(&info);info.xsize=w;info.ysize=h;
  info.bits_per_sample=8;info.num_color_channels=3;info.num_extra_channels=1;info.alpha_bits=8;info.uses_original_profile=lossless;
  JxlColorEncoding color;JxlColorEncodingSetToSRGB(&color,JXL_FALSE);
  if(JxlEncoderSetBasicInfo(enc.get(),&info)!=JXL_ENC_SUCCESS || JxlEncoderSetColorEncoding(enc.get(),&color)!=JXL_ENC_SUCCESS) return fail("JPEG XL image setup failed");
  auto* frame=JxlEncoderFrameSettingsCreate(enc.get(),nullptr);
  if(!frame || JxlEncoderFrameSettingsSetOption(frame,JXL_ENC_FRAME_SETTING_EFFORT,jxl_effort)!=JXL_ENC_SUCCESS ||
     JxlEncoderFrameSettingsSetOption(frame,JXL_ENC_FRAME_SETTING_KEEP_INVISIBLE,1)!=JXL_ENC_SUCCESS ||
     JxlEncoderSetFrameDistance(frame,lossless?0:std::max(0.01f,JxlEncoderDistanceFromQuality(quality)))!=JXL_ENC_SUCCESS ||
     JxlEncoderSetFrameLossless(frame,lossless)!=JXL_ENC_SUCCESS || JxlEncoderSetExtraChannelDistance(frame,0,0)!=JXL_ENC_SUCCESS) return fail("JPEG XL frame setup failed");
  JxlPixelFormat pixels{4,JXL_TYPE_UINT8,JXL_NATIVE_ENDIAN,0};
  if(JxlEncoderAddImageFrame(frame,&pixels,rgba,length)!=JXL_ENC_SUCCESS) return fail("JPEG XL input rejected");
  JxlEncoderCloseInput(enc.get());output.resize(65536);size_t used=0;
  for(;;) {
   uint8_t* next=output.data()+used;size_t available=output.size()-used;
   auto status=JxlEncoderProcessOutput(enc.get(),&next,&available);used=output.size()-available;
   if(status==JXL_ENC_SUCCESS){output.resize(used);break;}
   if(status!=JXL_ENC_NEED_MORE_OUTPUT || output.size()>=limit)return fail("JPEG XL output failed or exceeds 256 MiB");
   output.resize(std::min(limit,output.size()*2));
  }
 }
 width=w;height=h;return output.empty()?fail("Empty encoded output"):0;
}
int viewer_modern_decode(const uint8_t* input,size_t length,int kind) {
 viewer_modern_clear();
 if(!input || !length || length>limit) return fail("Empty input or file exceeds 256 MiB");
 if(kind==1) {
  if(!WebPGetInfo(input,length,&width,&height) || !dimensions(width,height)) return fail("Invalid WebP or exceeds 40 megapixels");
  output.resize(size_t(width)*height*4);
  if(!WebPDecodeRGBAInto(input,length,output.data(),output.size(),width*4)) return fail("WebP decode failed");
  return 0;
 }
 if(kind!=2) return fail("Unknown codec");
 std::unique_ptr<JxlDecoder,decltype(&JxlDecoderDestroy)> dec(JxlDecoderCreate(nullptr),JxlDecoderDestroy);
 if(!dec) return fail("Cannot allocate JPEG XL decoder");
 JxlPixelFormat pixels{4,JXL_TYPE_UINT8,JXL_NATIVE_ENDIAN,0};
 bool grid_allowed=false;
 if(JxlDecoderSubscribeEvents(dec.get(),JXL_DEC_BASIC_INFO|JXL_DEC_COLOR_ENCODING|JXL_DEC_FULL_IMAGE)!=JXL_DEC_SUCCESS || JxlDecoderSetInput(dec.get(),input,length)!=JXL_DEC_SUCCESS) return fail("JPEG XL input rejected");
 JxlDecoderCloseInput(dec.get());
 for(;;) {
  auto status=JxlDecoderProcessInput(dec.get());
  if(status==JXL_DEC_BASIC_INFO) {
   JxlBasicInfo info;
   if(JxlDecoderGetBasicInfo(dec.get(),&info)!=JXL_DEC_SUCCESS || info.xsize>40000000 || info.ysize>40000000 || !dimensions(info.xsize,info.ysize)) return fail("JPEG XL exceeds 40 megapixels");
   width=info.xsize;height=info.ysize;
   grid_allowed=info.orientation==JXL_ORIENT_IDENTITY && !info.have_animation;
  } else if(status==JXL_DEC_COLOR_ENCODING) {
   JxlColorEncoding color;JxlColorEncodingSetToSRGB(&color,JXL_FALSE);
   if(JxlDecoderSetPreferredColorProfile(dec.get(),&color)!=JXL_DEC_SUCCESS) return fail("JPEG XL color conversion failed");
  } else if(status==JXL_DEC_NEED_IMAGE_OUT_BUFFER) {
   size_t size=0;
   if(!dimensions(width,height) || JxlDecoderImageOutBufferSize(dec.get(),&pixels,&size)!=JXL_DEC_SUCCESS || size!=size_t(width)*height*4) return fail("Invalid JPEG XL pixel allocation");
   output.resize(size);
   if(JxlDecoderSetImageOutBuffer(dec.get(),&pixels,output.data(),size)!=JXL_DEC_SUCCESS) return fail("JPEG XL output rejected");
  } else if(status==JXL_DEC_FULL_IMAGE) {
   if(grid_allowed){
    const size_t count=(size_t(width)+7)/8*((size_t(height)+7)/8);
    if(count<=625000){
     block_owners.resize(count);
     if(viewer_jxl_block_map(dec.get(),block_owners.data(),count,width,height)!=count)
      block_owners.clear();
    }
   }
   return 0; // First coalesced frame, with orientation applied.
  }
  else return fail("Invalid or truncated JPEG XL");
 }
}
}
