"""Generate original synthetic HEIC fixtures. Requires Pillow and pillow-heif.
Copyright (c) 2026 Ilya Barilo. MIT. No photos, network or filesystem walks.
"""
import hashlib
import json
from pathlib import Path
from array import array
from PIL import Image
import PIL
import pillow_heif

destination = Path(__file__).resolve().parent.parent / 'fixtures/heic'
destination.mkdir(parents=True, exist_ok=True)
cases = []

def pattern(width, height, alpha=False):
    data = bytearray()
    for y in range(height):
        for x in range(width):
            color = [(x * 255) // max(1, width - 1), (y * 255) // max(1, height - 1),
                     220 if (x // 12 + y // 12) % 2 else 30]
            if alpha:
                color.append([0, 64, 128, 192, 255][min(4, x * 5 // width)])
            data.extend(color)
    return bytes(data)

def record(name):
    file = destination / (name + '.heic')
    decoded = pillow_heif.read_heif(file, convert_hdr_to_8bit=True)
    expected = decoded.to_pillow().convert('RGBA')
    expected.save(destination / (name + '.png'))
    cases.append({'name': name, 'file': file.name, 'expected': name + '.png',
                  'width': expected.width, 'height': expected.height,
                  'bitDepth': decoded.info.get('bit_depth'), 'bytes': file.stat().st_size,
                  'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})

base = pattern(96, 64)
pillow_heif.encode('RGB', (96, 64), base, destination / 'rgb8.heic', quality=95, chroma='444')
record('rgb8')
pillow_heif.encode('RGBA', (96, 64), pattern(96, 64, True), destination / 'alpha8.heic', quality=95, chroma='444')
record('alpha8')
for name, orientation in [('rotate90', 6), ('mirror', 2)]:
    exif = Image.Exif()
    exif[274] = orientation
    pillow_heif.encode('RGB', (96, 64), base, destination / (name + '.heic'), quality=95, chroma='444', exif=exif.tobytes())
    record(name)
hdr = array('H', (int(value * 65535 / 255) for value in base))
pillow_heif.encode('RGB;16', (96, 64), hdr.tobytes(), destination / 'rgb10.heic', quality=95, chroma='444')
record('rgb10')
multi = pillow_heif.from_bytes('RGB', (32, 48), bytes([255, 0, 0]) * 32 * 48)
multi.add_frombytes('RGB', (96, 64), base)
multi.save(destination / 'primary-second.heic', quality=95, chroma='444', primary_index=1)
record('primary-second')
pillow_heif.encode('RGB', (128, 96), pattern(128, 96), destination / 'grid.heic', quality=95, chroma='444', tile_size=64)
record('grid')
pillow_heif.encode('RGB', (2048, 1536), pattern(2048, 1536), destination / 'large.heic', quality=85)
record('large')
report = {'generator': 'tests/support/generate-heic-fixtures.py', 'license': 'MIT project',
          'pillow': PIL.__version__, 'pillowHeif': pillow_heif.__version__,
          'nativeLibrary': pillow_heif.libheif_info(), 'cases': cases}
(destination / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
