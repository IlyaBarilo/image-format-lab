// Image Format Lab memory bridge (MIT); upstream OpenJPEG keeps its BSD-2-Clause terms.
#include "openjpeg.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

typedef struct { uint8_t *data; size_t pos, length, capacity; int writable; } buffer_t;
static void error_cb(const char *message, void *unused) { (void)unused; fputs(message, stderr); }
static int reserve(buffer_t *b, size_t end) {
    if (end > 256u * 1024u * 1024u) return 0;
    if (end <= b->capacity) return 1;
    size_t cap = b->capacity ? b->capacity : 65536;
    while (cap < end) cap *= 2;
    uint8_t *p = realloc(b->data, cap);
    if (!p) return 0;
    b->data = p; b->capacity = cap;
    return 1;
}
static OPJ_SIZE_T read_cb(void *dst, OPJ_SIZE_T n, void *user) {
    buffer_t *b = user;
    if (b->pos >= b->length) return (OPJ_SIZE_T)-1;
    if (n > b->length - b->pos) n = b->length - b->pos;
    memcpy(dst, b->data + b->pos, n); b->pos += n;
    return n;
}
static OPJ_SIZE_T write_cb(void *src, OPJ_SIZE_T n, void *user) {
    buffer_t *b = user;
    if (n > SIZE_MAX - b->pos || !reserve(b, b->pos + n)) return (OPJ_SIZE_T)-1;
    memcpy(b->data + b->pos, src, n); b->pos += n;
    if (b->pos > b->length) b->length = b->pos;
    return n;
}
static OPJ_OFF_T skip_cb(OPJ_OFF_T n, void *user) {
    buffer_t *b = user;
    if (n < 0 && (uint64_t)-n > b->pos) return -1;
    size_t next = b->pos + n;
    if (b->writable) {
        if (!reserve(b, next)) return -1;
        if (next > b->length) { memset(b->data + b->length, 0, next - b->length); b->length = next; }
    } else if (next > b->length) return -1;
    b->pos = next; return n;
}
static OPJ_BOOL seek_cb(OPJ_OFF_T n, void *user) {
    buffer_t *b = user;
    if (n < 0) return OPJ_FALSE;
    size_t next = (size_t)n;
    if (b->writable) {
        if (!reserve(b, next)) return OPJ_FALSE;
        if (next > b->length) { memset(b->data + b->length, 0, next - b->length); b->length = next; }
    } else if (next > b->length) return OPJ_FALSE;
    b->pos = next; return OPJ_TRUE;
}
static opj_stream_t *make_stream(buffer_t *b, int reading) {
    opj_stream_t *s = opj_stream_create(65536, reading ? OPJ_TRUE : OPJ_FALSE);
    if (!s) return NULL;
    opj_stream_set_user_data(s, b, NULL);
    if (reading) { opj_stream_set_user_data_length(s, b->length); opj_stream_set_read_function(s, read_cb); }
    else opj_stream_set_write_function(s, write_cb);
    opj_stream_set_skip_function(s, skip_cb); opj_stream_set_seek_function(s, seek_cb);
    return s;
}

int eval_encode(const uint16_t *samples, int w, int h, int depth, int channels,
                int jp2, int ratio, const uint8_t *icc, int icc_length,
                uint8_t **result, int *result_length) {
    if (!samples || !result || !result_length || w < 1 || h < 1 || w > 8192 || h > 8192 ||
        (size_t)w * h > (depth == 16 ? 4u : 8u) * 1024u * 1024u || (depth != 8 && depth != 16) ||
        (channels != 1 && channels != 3 && channels != 4) || ratio < 0 ||
        icc_length < 0 || icc_length > 1024 * 1024 || (icc_length && (!icc || !jp2))) return 0;
    opj_image_cmptparm_t desc[4]; memset(desc, 0, sizeof(desc));
    for (int c = 0; c < channels; ++c) { desc[c].dx = desc[c].dy = 1; desc[c].w = w; desc[c].h = h; desc[c].prec = depth; }
    opj_image_t *image = opj_image_create(channels, desc, channels == 1 ? OPJ_CLRSPC_GRAY : OPJ_CLRSPC_SRGB);
    if (!image) return 0;
    image->x1 = w; image->y1 = h;
    if (channels == 4) image->comps[3].alpha = 1;
    if (icc_length) {
        image->icc_profile_buf = malloc(icc_length);
        if (!image->icc_profile_buf) { opj_image_destroy(image); return 0; }
        memcpy(image->icc_profile_buf, icc, icc_length);
        image->icc_profile_len = icc_length;
    }
    for (size_t i = 0, n = (size_t)w * h; i < n; ++i)
        for (int c = 0; c < channels; ++c) image->comps[c].data[i] = samples[i * channels + c];
    opj_cparameters_t p; opj_set_default_encoder_parameters(&p);
    p.tcp_numlayers = 1; p.cp_disto_alloc = 1; p.tcp_rates[0] = (float)ratio;
    p.irreversible = ratio ? 1 : 0; p.tcp_mct = channels >= 3 ? 1 : 0;
    p.numresolution = 1; for (int x = w < h ? w : h; x >= 2 && p.numresolution < 6; x >>= 1) p.numresolution++;
    opj_codec_t *codec = opj_create_compress(jp2 ? OPJ_CODEC_JP2 : OPJ_CODEC_J2K);
    if (!codec) { opj_image_destroy(image); return 0; }
    opj_set_error_handler(codec, error_cb, NULL);
    buffer_t b = {0}; b.writable = 1;
    opj_stream_t *stream = make_stream(&b, 0);
    int ok = stream && opj_setup_encoder(codec, &p, image) &&
             opj_start_compress(codec, image, stream) && opj_encode(codec, stream) &&
             opj_end_compress(codec, stream) && b.length <= INT32_MAX;
    if (stream) opj_stream_destroy(stream);
    opj_destroy_codec(codec); opj_image_destroy(image);
    if (!ok) { free(b.data); return 0; }
    *result = b.data; *result_length = (int)b.length; return 1;
}

int eval_decode(uint8_t *input, int length, int jp2, uint16_t **result,
                int *w, int *h, int *depth, int *channels, int *alpha, int *icc_length,
                uint8_t **icc_data) {
    if (!input || length < 1 || length > 64 * 1024 * 1024 || !result || !w || !h || !depth || !channels || !alpha || !icc_length || !icc_data) return 0;
    buffer_t b = {0}; b.data = input; b.length = length;
    opj_codec_t *codec = opj_create_decompress(jp2 ? OPJ_CODEC_JP2 : OPJ_CODEC_J2K);
    if (!codec) return 0;
    opj_set_error_handler(codec, error_cb, NULL);
    opj_dparameters_t p; opj_set_default_decoder_parameters(&p);
    opj_image_t *image = NULL; opj_stream_t *stream = make_stream(&b, 1);
    int ok = stream && opj_setup_decoder(codec, &p) && opj_read_header(stream, codec, &image);
    if (ok) ok = image->x1 > image->x0 && image->y1 > image->y0 &&
                 image->x1 - image->x0 <= 8192 && image->y1 - image->y0 <= 8192 &&
                 (image->numcomps == 1 || image->numcomps == 3 || image->numcomps == 4) &&
                 (image->numcomps == 1 ? image->color_space == OPJ_CLRSPC_GRAY || image->color_space == OPJ_CLRSPC_UNSPECIFIED || image->color_space == OPJ_CLRSPC_UNKNOWN :
                  image->color_space == OPJ_CLRSPC_SRGB || image->color_space == OPJ_CLRSPC_UNSPECIFIED || image->color_space == OPJ_CLRSPC_UNKNOWN);
    if (ok) {
        int precision = image->comps[0].prec;
        ok = (precision == 8 || precision == 16) &&
             (size_t)(image->x1 - image->x0) * (image->y1 - image->y0) <= (precision == 16 ? 4u : 8u) * 1024u * 1024u;
        for (int c = 0; ok && c < (int)image->numcomps; ++c)
            ok = image->comps[c].prec == (OPJ_UINT32)precision && !image->comps[c].sgnd &&
                 image->comps[c].dx == 1 && image->comps[c].dy == 1 &&
                 image->comps[c].w == image->x1 - image->x0 &&
                 image->comps[c].h == image->y1 - image->y0;
    }
    if (ok) ok = opj_decode(codec, stream, image) && opj_end_decompress(codec, stream);
    int interpreted_alpha = image && image->numcomps == 4 &&
        (image->comps[3].alpha || !jp2 ||
         (image->icc_profile_buf && image->icc_profile_len >= 20 &&
          !memcmp(image->icc_profile_buf + 16, "RGB ", 4)));
    if (ok && image->numcomps == 4 && !interpreted_alpha) ok = 0;
    uint16_t *samples = NULL;
    uint8_t *profile = NULL;
    if (ok) {
        *w = image->x1 - image->x0; *h = image->y1 - image->y0; *channels = image->numcomps;
        *depth = image->comps[0].prec; *alpha = interpreted_alpha;
        *icc_length = image->icc_profile_len;
        if (*icc_length > 0 && *icc_length <= 1024 * 1024 && image->icc_profile_buf) {
            profile = malloc(*icc_length);
            if (profile) memcpy(profile, image->icc_profile_buf, *icc_length);
            else ok = 0;
        } else if (*icc_length) ok = 0;
        size_t n = (size_t)*w * *h;
        samples = malloc(n * *channels * sizeof(uint16_t));
        if (!samples) ok = 0;
        else for (size_t i = 0; i < n; ++i) for (int c = 0; c < *channels; ++c)
            samples[i * *channels + c] = image->comps[c].data[i];
    }
    if (stream) opj_stream_destroy(stream);
    opj_destroy_codec(codec); if (image) opj_image_destroy(image);
    if (!ok) { free(samples); free(profile); return 0; }
    *result = samples; *icc_data = profile; return 1;
}
void eval_free(void *p) { free(p); }
