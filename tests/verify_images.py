"""Read generated images with Pillow, independently of the app's preview path."""
import base64
import io
import json
import sys
from PIL import Image, __version__ as pillow_version

cases = json.load(sys.stdin)
print(f'Pillow {pillow_version}')
failures = []
for case in cases:
    try:
        with Image.open(io.BytesIO(base64.b64decode(case['data']))) as image:
            image.load()
            assert image.format == case['format'], image.format
            rgba = image.convert('RGBA')
            expected = base64.b64decode(case['expected'])
            assert rgba.tobytes() == expected, 'decoded pixels differ from encoded palette/matte'
            if 'limit' in case:
                raw = rgba.tobytes()
                assert len({raw[i:i + 4] for i in range(0, len(raw), 4)}) <= case['limit'], 'palette limit exceeded'
    except Exception as error:
        failures.append(f"FAIL {case['name']}: {error}")

for line in failures[:15]:
    print(line)
if len(failures) > 15:
    print(f'... {len(failures) - 15} further failures')
print(f'Independent decode: {len(cases) - len(failures)}/{len(cases)} passed')
sys.exit(bool(failures))
