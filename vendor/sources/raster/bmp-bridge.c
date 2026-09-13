/* Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <libnsbmp.h>
static uint8_t *pixels;
static int width,height;
static size_t allocated_pixels;
static void *bitmap_create(int w,int h,unsigned flags) {
    if(w<=0 || h<=0 || (uint64_t)w*h>40000000-allocated_pixels) return NULL;
    allocated_pixels+=(size_t)w*h;
    return calloc((size_t)w*h,4);
}
static void bitmap_destroy(void *bitmap){free(bitmap);}
static unsigned char *bitmap_buffer(void *bitmap){return bitmap;}
void viewer_bmp_clear(void){free(pixels);pixels=NULL;width=height=0;}
uint8_t *viewer_bmp_pixels(void){return pixels;}
int viewer_bmp_width(void){return width;}
int viewer_bmp_height(void){return height;}
static void normalize_channels(bmp_image *bmp) {
    // libnsbmp left-aligns sub-byte channel values. Expand their complete range
    // to 0..255 so RGB555/565 white does not become 248/252/248.
    unsigned maximum[4]={255,255,255,255};
    if(bmp->bpp==16 && bmp->encoding!=BMP_ENCODING_BITFIELDS)
        maximum[0]=maximum[1]=maximum[2]=248;
    if(bmp->encoding==BMP_ENCODING_BITFIELDS)for(unsigned c=0;c<4;c++) {
        uint64_t mask=bmp->mask[c];
        if(!mask || (c==3 && (bmp->opaque || bmp->ico)))continue;
        if(bmp->shift[c]>0)mask<<=bmp->shift[c];else mask>>=-bmp->shift[c];
        maximum[c]=(mask>>(8*c))&255;
    }
    uint8_t *data=bmp->bitmap;
    if(maximum[0]==255 && maximum[1]==255 && maximum[2]==255 && maximum[3]==255)return;
    for(size_t p=0;p<(size_t)bmp->width*bmp->height;p++)for(unsigned c=0;c<4;c++)
        if(maximum[c] && maximum[c]<255) {
            unsigned value=((unsigned)data[p*4+c]*255+maximum[c]/2)/maximum[c];
            data[p*4+c]=value>255?255:value;
        }
}
int viewer_bmp_decode(uint8_t *input,size_t size,int ico) {
    viewer_bmp_clear();
    allocated_pixels=0;
    if(!input || size<14 || size>268435456)return 1;
    bmp_bitmap_callback_vt cb={bitmap_create,bitmap_destroy,bitmap_buffer};
    bmp_image bmp={0},*selected=&bmp;ico_collection collection={0};
    int result;
    if(ico){
        ico_collection_create(&collection,&cb);result=ico_analyse(&collection,size,input);
        if(result==BMP_OK){selected=ico_find(&collection,256,256);if(!selected)result=BMP_DATA_ERROR;}
    }else{bmp_create(&bmp,&cb);result=bmp_analyse(&bmp,size,input);}
    if(result==BMP_OK && (selected->width==0 || selected->height==0 || (uint64_t)selected->width*selected->height>40000000))result=BMP_DATA_ERROR;
    if(result==BMP_OK)result=bmp_decode(selected);
    if(result==BMP_OK){
        if(selected->bitmap)normalize_channels(selected);
        width=selected->width;height=selected->height;pixels=selected->bitmap;selected->bitmap=NULL;
        if(!pixels)result=BMP_INSUFFICIENT_MEMORY;
    }
    if(ico)ico_finalise(&collection);else bmp_finalise(&bmp);
    if(result!=BMP_OK)viewer_bmp_clear();
    return result;
}
