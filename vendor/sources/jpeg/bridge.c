/* Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
 * Synchronous, bounded libjpeg API for the TIFF Worker. No files or callbacks
 * into JavaScript. The caller copies the result before clear/free.
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <setjmp.h>
#define JPEG_INTERNALS
#include <jpeglib.h>
#include <jconfig.h>

static struct jpeg_decompress_struct decoder;
static struct { struct jpeg_error_mgr base; jmp_buf jump; } errors;
static int created;
static unsigned char *pixels;
static unsigned width, height, components, precision, lossless, adobe;
static size_t bytes;
static char message[JMSG_LENGTH_MAX];

static void failed(j_common_ptr info) {
  (*info->err->format_message)(info, message);
  longjmp(errors.jump, 1);
}
static void warning(j_common_ptr info, int level) {
  /* Truncated/corrupt input must not silently produce a successful preview. */
  if (level < 0) failed(info);
}
void viewer_jpeg_clear(void) {
  if (created) { jpeg_destroy_decompress(&decoder); created = 0; }
  free(pixels); pixels = NULL;
  bytes = width = height = components = precision = lossless = adobe = 0;
}
static int reject(const char *reason) {
  snprintf(message, sizeof(message), "%s", reason);
  viewer_jpeg_clear();
  return 1;
}
int viewer_jpeg_decode(const unsigned char *input, size_t size, int raw) {
  viewer_jpeg_clear(); message[0] = 0;
  if (!input || size < 4 || size > 268435456) return reject("Invalid JPEG input size");
  memset(&decoder, 0, sizeof(decoder));
  decoder.err = jpeg_std_error(&errors.base);
  errors.base.error_exit = failed;
  errors.base.emit_message = warning;
  if (setjmp(errors.jump)) { viewer_jpeg_clear(); return 1; }
  created = 1;
  jpeg_create_decompress(&decoder);
  jpeg_mem_src(&decoder, input, size);
  if (jpeg_read_header(&decoder, TRUE) != JPEG_HEADER_OK) return reject("Invalid JPEG header");
  if (!decoder.image_width || !decoder.image_height ||
      (uint64_t)decoder.image_width * decoder.image_height > 40000000)
    return reject("JPEG exceeds 40 megapixels");
  if (decoder.num_components < 1 || decoder.num_components > 4)
    return reject("Unsupported JPEG component count");
  precision = decoder.data_precision;
  lossless = decoder.master->lossless;
  adobe = decoder.saw_Adobe_marker;
  if (precision < 2 || precision > 16) return reject("Unsupported JPEG precision");
  if (raw) decoder.jpeg_color_space = decoder.out_color_space = JCS_UNKNOWN;
  else if (lossless) decoder.out_color_space = decoder.jpeg_color_space;
  else if (decoder.jpeg_color_space == JCS_CMYK || decoder.jpeg_color_space == JCS_YCCK)
    decoder.out_color_space = JCS_CMYK;
  else if (decoder.num_components == 3) decoder.out_color_space = JCS_RGB;
  decoder.dct_method = JDCT_ISLOW;
  decoder.mem->max_memory_to_use = 268435456;
  jpeg_start_decompress(&decoder);
  width = decoder.output_width; height = decoder.output_height;
  components = decoder.output_components;
  bytes = (size_t)width * height * components * (precision > 8 ? 2 : 1);
  pixels = malloc(bytes);
  if (!pixels) return reject("Not enough memory for JPEG pixels");
  while (decoder.output_scanline < height) {
    size_t offset = (size_t)decoder.output_scanline * width * components;
    JDIMENSION read;
    if (precision > 12) {
      J16SAMPROW row = (J16SAMPROW)pixels + offset;
      read = jpeg16_read_scanlines(&decoder, &row, 1);
    } else if (precision > 8) {
      J12SAMPROW row = (J12SAMPROW)pixels + offset;
      read = jpeg12_read_scanlines(&decoder, &row, 1);
    } else {
      JSAMPROW row = pixels + offset;
      read = jpeg_read_scanlines(&decoder, &row, 1);
    }
    if (read != 1) return reject("Incomplete JPEG scanline");
  }
  jpeg_finish_decompress(&decoder);
  jpeg_destroy_decompress(&decoder); created = 0;
  return 0;
}
const char *viewer_jpeg_error(void) { return message; }
#define STRING_VALUE(x) #x
#define EXPAND_STRING(x) STRING_VALUE(x)
const char *viewer_jpeg_version(void) { return EXPAND_STRING(LIBJPEG_TURBO_VERSION); }
unsigned viewer_jpeg_width(void) { return width; }
unsigned viewer_jpeg_height(void) { return height; }
unsigned viewer_jpeg_components(void) { return components; }
unsigned viewer_jpeg_precision(void) { return precision; }
unsigned viewer_jpeg_lossless(void) { return lossless; }
unsigned viewer_jpeg_adobe(void) { return adobe; }
const void *viewer_jpeg_pixels(void) { return pixels; }
size_t viewer_jpeg_bytes(void) { return bytes; }
