// Copyright (c) 2026 Ilya Barilo. MIT; see PROJECT-LICENSE.
// Uses the public libheif / libde265 APIs; their LGPL terms remain unchanged.
#include <libheif/heif.h>
#include <libde265/de265.h>
#include <cstdint>
#include <cstdio>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <memory>

namespace {
heif_context* context = nullptr;
heif_image_handle* handle = nullptr;
heif_image* decoded = nullptr;
char last_error[512] = {};
constexpr uint64_t max_pixels = 40000000;
uint8_t* output = nullptr;
size_t output_size = 0, output_capacity = 0;
int fail(const char* message) {
  std::snprintf(last_error, sizeof(last_error), "%s", message ? message : "HEIC decoding failed");
  return 1;
}
bool valid_size(int width, int height) {
  return width > 0 && height > 0 && uint64_t(width) * uint64_t(height) <= max_pixels;
}
heif_error write_output(heif_context*, const void* data, size_t size, void*) {
  constexpr size_t limit = 256u * 1024 * 1024;
  if (size > limit - output_size) return {heif_error_Encoding_error, heif_suberror_Unspecified, "HEIC output exceeds 256 MiB"};
  const size_t needed = output_size + size;
  if (needed > output_capacity) {
    size_t capacity = needed > output_capacity * 2 ? needed : output_capacity * 2;
    if (capacity > limit) capacity = limit;
    auto* replacement = static_cast<uint8_t*>(std::realloc(output, capacity));
    if (!replacement) return {heif_error_Memory_allocation_error, heif_suberror_Unspecified, "Cannot allocate HEIC output"};
    output = replacement; output_capacity = capacity;
  }
  if (size) std::memcpy(output + output_size, data, size);
  output_size += size;
  return {heif_error_Ok, heif_suberror_Unspecified, nullptr};
}
}

extern "C" {
void viewer_heic_clear() {
  if (decoded) heif_image_release(decoded);
  if (handle) heif_image_handle_release(handle);
  if (context) heif_context_free(context);
  decoded = nullptr; handle = nullptr; context = nullptr;
  std::free(output); output = nullptr; output_size = output_capacity = 0;
}
const char* viewer_heic_error() { return last_error; }
const char* viewer_heic_version() { return heif_get_version(); }
const char* viewer_de265_version() { return de265_get_version(); }
int viewer_heic_can_encode() { return heif_have_encoder_for_format(heif_compression_HEVC); }
int viewer_avif_can_encode() { return heif_have_encoder_for_format(heif_compression_AV1); }
const uint8_t* viewer_heic_output() { return output; }
size_t viewer_heic_output_size() { return output_size; }
int viewer_heic_width() { return decoded ? heif_image_get_width(decoded, heif_channel_interleaved) : 0; }
int viewer_heic_height() { return decoded ? heif_image_get_height(decoded, heif_channel_interleaved) : 0; }
size_t viewer_heic_stride() {
  size_t stride = 0;
  if (decoded) heif_image_get_plane_readonly2(decoded, heif_channel_interleaved, &stride);
  return stride;
}
const uint8_t* viewer_heic_pixels() {
  size_t stride = 0;
  return decoded ? heif_image_get_plane_readonly2(decoded, heif_channel_interleaved, &stride) : nullptr;
}
int viewer_heic_premultiplied() { return decoded && heif_image_is_premultiplied_alpha(decoded); }
int viewer_heic_decode(const uint8_t* input, size_t length) {
  viewer_heic_clear(); last_error[0] = 0;
  if (!input || !length) return fail("Empty HEIC input");
  context = heif_context_alloc();
  if (!context) return fail("Cannot allocate HEIC context");
  auto* limits = heif_context_get_security_limits(context);
  limits->max_image_size_pixels = max_pixels;
  limits->max_memory_block_size = 256ull * 1024 * 1024;
  limits->max_total_memory = 512ull * 1024 * 1024;
  heif_context_set_max_decoding_threads(context, 0);
  auto error = heif_context_read_from_memory_without_copy(context, input, length, nullptr);
  if (error.code) return fail(error.message);
  error = heif_context_get_primary_image_handle(context, &handle);
  if (error.code) return fail(error.message);
  if (!valid_size(heif_image_handle_get_width(handle), heif_image_handle_get_height(handle)))
    return fail("HEIC image exceeds the 40 megapixel limit or has invalid dimensions");
  auto* options = heif_decoding_options_alloc();
  if (!options) return fail("Cannot allocate HEIC decoding options");
  options->ignore_transformations = 0;
  options->convert_hdr_to_8bit = 1;
  options->strict_decoding = 1;
  error = heif_decode_image(handle, &decoded, heif_colorspace_RGB, heif_chroma_interleaved_RGBA, options);
  heif_decoding_options_free(options);
  if (error.code) return fail(error.message);
  if (!valid_size(viewer_heic_width(), viewer_heic_height())) return fail("Invalid decoded HEIC dimensions");
  if (!viewer_heic_pixels() || viewer_heic_stride() < size_t(viewer_heic_width()) * 4)
    return fail("Invalid decoded HEIC pixel plane");
  return 0;
}
int encode_image(const uint8_t* rgba, size_t length, int width, int height, int quality, heif_compression_format format) {
  viewer_heic_clear(); last_error[0] = 0;
  if (!rgba || !valid_size(width, height) || length != size_t(width) * height * 4 || quality < 1 || quality > 100)
    return fail("Invalid HEIC pixels, quality, or 40 megapixel limit exceeded");
  context = heif_context_alloc();
  if (!context) return fail("Cannot allocate HEIC context");
  bool alpha = false;
  for (size_t i = 3; i < length; i += 4) if (rgba[i] != 255) { alpha = true; break; }
  auto error = heif_image_create(width, height, heif_colorspace_RGB,
      alpha ? heif_chroma_interleaved_RGBA : heif_chroma_interleaved_RGB, &decoded);
  if (error.code) return fail(error.message);
  auto* profile = heif_nclx_color_profile_alloc();
  if (!profile) return fail("Cannot allocate HEIC color profile");
  // Canvas supplies sRGB. Record its primaries/transfer and full-range BT.601 YCbCr.
  heif_nclx_color_profile_set_color_primaries(profile, 1);
  heif_nclx_color_profile_set_transfer_characteristics(profile, 13);
  heif_nclx_color_profile_set_matrix_coefficients(profile, 6);
  profile->full_range_flag = 1;
  error = heif_image_set_nclx_color_profile(decoded, profile);
  heif_nclx_color_profile_free(profile);
  if (error.code) return fail(error.message);
  error = heif_image_add_plane(decoded, heif_channel_interleaved, width, height, 8);
  if (error.code) return fail(error.message);
  int stride = 0;
  auto* pixels = heif_image_get_plane(decoded, heif_channel_interleaved, &stride);
  if (!pixels || stride < width * (alpha ? 4 : 3)) return fail("Invalid HEIC input plane");
  for (int y = 0; y < height; y++) {
    auto* row = pixels + size_t(y) * stride;
    const auto* source = rgba + size_t(y) * width * 4;
    if (alpha) std::memcpy(row, source, size_t(width) * 4);
    else for (int x = 0; x < width; x++) std::memcpy(row + size_t(x) * 3, source + size_t(x) * 4, 3);
  }
  heif_encoder* raw_encoder = nullptr;
  error = heif_context_get_encoder_for_format(context, format, &raw_encoder);
  if (error.code) return fail(error.message);
  std::unique_ptr<heif_encoder, decltype(&heif_encoder_release)> encoder(raw_encoder, heif_encoder_release);
  error = heif_encoder_set_lossy_quality(encoder.get(), quality);
  if (error.code) return fail(error.message);
  if (format == heif_compression_AV1) {
    error = heif_encoder_set_parameter_integer(encoder.get(), "speed", 6);
    if (error.code) return fail(error.message);
    error = heif_encoder_set_parameter_integer(encoder.get(), "threads", 1);
    if (error.code) return fail(error.message);
  }
  error = heif_context_encode_image(context, decoded, encoder.get(), nullptr, &handle);
  if (error.code) return fail(error.message);
  heif_writer writer{1, write_output};
  error = heif_context_write(context, &writer, nullptr);
  if (error.code) return fail(error.message);
  if (output_size < 16) return fail("Empty HEIC output");
  return 0;
}
int viewer_heic_encode(const uint8_t* rgba, size_t length, int width, int height, int quality) {
  return encode_image(rgba, length, width, height, quality, heif_compression_HEVC);
}
int viewer_avif_encode(const uint8_t* rgba, size_t length, int width, int height, int quality) {
  return encode_image(rgba, length, width, height, quality, heif_compression_AV1);
}
}
