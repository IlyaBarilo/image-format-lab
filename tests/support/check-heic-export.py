"""Independently inspect browser-produced HEIC files; no application code is imported."""
import base64
import io
import json
import sys
import pillow_heif

rows = []
for case in json.load(sys.stdin):
    image = pillow_heif.read_heif(io.BytesIO(base64.b64decode(case['heic'])))
    assert image.size == (case['width'], case['height'])
    assert image.info['bit_depth'] == 8 and image.info['chroma'] == 420
    source = base64.b64decode(case['rgba'])
    pixels = image.to_pillow().convert('RGBA').tobytes()
    alpha = max(abs(a-b) for a,b in zip(source[3::4],pixels[3::4]))
    mean = sum(abs(a-b) for i,(a,b) in enumerate(zip(source,pixels)) if i%4 != 3)/(case['width']*case['height']*3)
    if not case['alpha']: assert alpha == 0
    if case['quality'] >= 25: assert mean < 16
    if case['alpha'] and case['quality'] >= 85: assert alpha <= 2
    rows.append({'width':image.size[0], 'height':image.size[1], 'quality':case['quality'],
                 'alphaMaxError':alpha, 'rgbMeanError':round(mean,4)})
print(json.dumps({'pillowHeif':pillow_heif.__version__, 'libraries':pillow_heif.libheif_info(), 'cases':rows}))
