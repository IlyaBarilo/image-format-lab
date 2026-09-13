"""Original synthetic JPEG/TIFF fixtures; no external images or file walks.
Copyright (c) 2026 Ilya Barilo. MIT. Requires Pillow for lossy JPEG/reference PNG.
Lossless SOF3 encoder below is independent of the decoder under test.
"""
from io import BytesIO
import hashlib
import json
from pathlib import Path
import struct
import PIL
from PIL import Image, features

out = Path(__file__).resolve().parent.parent / 'fixtures/tiff'
out.mkdir(parents=True, exist_ok=True)
cases, raw_cases = [], []

def segment(code, payload):
    return bytes([255, code]) + struct.pack('>H', len(payload) + 2) + bytes(payload)

def lossless(width, height, bits, channels, samples, predictor=1, point=0, restart_rows=0):
    """SOF3 with a simple fixed 5-bit Huffman code for categories 0..16."""
    result = bytearray(b'\xff\xd8')
    result += segment(196, [0] + [0]*4 + [17] + [0]*11 + list(range(17)))
    frame = [bits, height >> 8, height & 255, width >> 8, width & 255, channels]
    for c in range(channels):
        frame += [c + 1, 17, 0]
    result += segment(195, frame)
    if restart_rows:
        result += segment(221, struct.pack('>H', restart_rows * width))
    scan = [channels]
    for c in range(channels):
        scan += [c + 1, 0]
    result += segment(218, scan + [predictor, 0, point])
    accumulator = count = restart = 0
    def put(value, length):
        nonlocal accumulator, count
        accumulator = (accumulator << length) | value
        count += length
        while count >= 8:
            count -= 8
            byte = (accumulator >> count) & 255
            result.append(byte)
            if byte == 255:
                result.append(0)
        accumulator &= (1 << count) - 1
    def flush():
        if count:
            put((1 << (8-count)) - 1, 8-count)
    values = [v >> point for v in samples]
    for y in range(height):
        first_row = y == 0 or (restart_rows and y % restart_rows == 0)
        if y and first_row:
            flush()
            result.extend([255, 208 + restart % 8])
            restart += 1
        for x in range(width):
            for c in range(channels):
                i = (y * width + x) * channels + c
                if first_row and x == 0:
                    prediction = 1 << (bits - point - 1)
                elif first_row:
                    prediction = values[i - channels]
                elif x == 0:
                    prediction = values[i - width * channels]
                else:
                    a, b, d = values[i-channels], values[i-width*channels], values[i-(width+1)*channels]
                    prediction = [0, a, b, d, a+b-d, a+((b-d) >> 1), b+((a-d) >> 1), (a+b) >> 1][predictor]
                diff = (values[i] - prediction + 32768) % 65536 - 32768
                category = abs(diff).bit_length()
                put(category, 5)
                if 0 < category < 16:
                    put(diff if diff >= 0 else diff + (1 << category) - 1, category)
    flush()
    result.extend(b'\xff\xd9')
    return bytes(result)

def directory(tags, little=True):
    endian = '<' if little else '>'
    header = bytearray((b'II' if little else b'MM') + struct.pack(endian+'HI', 42, 8))
    header += struct.pack(endian+'H', len(tags))
    header += bytes(12 * len(tags) + 4)
    for i, (tag, (kind, values)) in enumerate(sorted(tags.items())):
        payload = bytes(values) if kind in (1, 7) else struct.pack(endian + ({3:'H',4:'I'}[kind] * len(values)), *values)
        at = 10 + i * 12
        header[at:at+8] = struct.pack(endian+'HHI', tag, kind, len(values))
        if len(payload) <= 4:
            header[at+8:at+12] = payload.ljust(4, b'\0')
        else:
            header[at+8:at+12] = struct.pack(endian+'I', len(header))
            header += payload
            if len(header) % 2:
                header.append(0)
    return bytes(header)

def tiff(width, height, bits, photo, strips, rows=None, tiles=None, tables=None, compression=7, little=True, legacy=None):
    tags = {256:(4,[width]),257:(4,[height]),258:(3,bits),259:(3,[compression]),262:(3,[photo]),277:(3,[len(bits)]),284:(3,[1])}
    offset_tag, count_tag = (324, 325) if tiles else (273, 279)
    tags[offset_tag] = (4,[0]*len(strips))
    tags[count_tag] = (4,list(map(len, strips)))
    if tiles:
        tags[322], tags[323] = (4,[tiles[0]]), (4,[tiles[1]])
    else:
        tags[278] = (4,[rows or height])
    if photo == 6:
        tags[530] = (3,[1,1])
    if tables:
        tags[347] = (7,tables)
    extras = []
    if legacy:
        for tag, chunks in legacy.items():
            tags[tag] = (4,[0]*len(chunks))
            extras.extend(chunks)
    position = len(directory(tags, little))
    if legacy:
        for tag, chunks in legacy.items():
            addresses = []
            for chunk in chunks:
                addresses.append(position)
                position += len(chunk)
            tags[tag] = (4,addresses)
    addresses = []
    for strip in strips:
        addresses.append(position)
        position += len(strip)
    tags[offset_tag] = (4,addresses)
    return directory(tags, little) + b''.join(extras) + b''.join(strips)

def split_jpeg(data):
    i, tables, rest, q, dc, ac = 2, bytearray(b'\xff\xd8'), bytearray(b'\xff\xd8'), {}, {}, {}
    while i < len(data):
        code = data[i+1]
        size = int.from_bytes(data[i+2:i+4], 'big')
        block = data[i:i+2+size]
        if code == 218:
            entropy = data[i+2+size:]
            rest += data[i:]
            break
        if code in (219,196):
            tables += block
            payload = block[4:]
            if code == 219:
                q[payload[0]] = payload[1:]
            else:
                (ac if payload[0] & 16 else dc)[payload[0] & 15] = payload[1:]
        else:
            rest += block
        i += 2+size
    tables += b'\xff\xd9'
    return bytes(tables), bytes(rest), entropy, {519:[q[0]], 520:[dc[0]], 521:[ac[0]]}

def jpeg(image, progressive=False, subsampling=0, keep_rgb=False):
    stream = BytesIO()
    image.save(stream, 'JPEG', quality=91, subsampling=subsampling, progressive=progressive, keep_rgb=keep_rgb)
    data = stream.getvalue()
    return data, Image.open(BytesIO(data)).convert('RGBA')

def record(name, data, reference, extra=None):
    (out / (name + '.tiff')).write_bytes(data)
    reference.save(out / (name + '.png'))
    cases.append({'name':name, 'file':name+'.tiff', 'expected':name+'.png', 'width':reference.width, 'height':reference.height,
                  'sha256':hashlib.sha256(data).hexdigest(), **(extra or {})})

w, h = 37, 23
rgb = Image.frombytes('RGB', (w,h), bytes(v for y in range(h) for x in range(w) for v in ((x*7)%256,(y*11)%256,30 if (x//4+y//4)%2 else 220)))
for name, compression in [('uncompressed','raw'),('lzw','tiff_lzw'),('deflate','tiff_adobe_deflate'),('packbits','packbits')]:
    stream = BytesIO(); rgb.save(stream,'TIFF',compression=compression)
    record(name, stream.getvalue(), rgb.convert('RGBA'))
for name, compression in [('fax3','group3'),('fax4','group4')]:
    image = rgb.convert('1'); stream = BytesIO(); image.save(stream,'TIFF',compression=compression)
    record(name,stream.getvalue(),image.convert('RGBA'))
for progressive in (False,True):
    data, expected = jpeg(rgb, progressive)
    record('progressive' if progressive else 'baseline',tiff(w,h,[8]*3,6,[data]),expected)
    if not progressive:
        (out/'baseline.jpg').write_bytes(data)
        record('old-complete',tiff(w,h,[8]*3,6,[data],compression=6),expected)
        assert len(data) < w*h*3
        record('jpeg-length-equals-output',tiff(w,h,[8]*3,6,[data.ljust(w*h*3,b'\0')]),expected)
for subsampling in (1,2):
    data, expected = jpeg(rgb, subsampling=subsampling)
    record('jpeg422' if subsampling == 1 else 'jpeg420',tiff(w,h,[8]*3,6,[data]),expected)
data, expected = jpeg(rgb, keep_rgb=True)
record('jpeg-rgb',tiff(w,h,[8]*3,2,[data]),expected)
gray = rgb.convert('L'); data, expected = jpeg(gray)
_, _, entropy, legacy = split_jpeg(data)
record('old-tables',tiff(w,h,[8],1,[entropy],compression=6,legacy=legacy),expected)
rows, strips, expected = 7, [], Image.new('RGBA',(w,h))
for y in range(0,h,rows):
    data, decoded = jpeg(rgb.crop((0,y,w,min(h,y+rows))))
    tables, abbreviated, _, _ = split_jpeg(data)
    strips.append(abbreviated)
    expected.paste(decoded,(0,y))
record('shared-tables-strips',tiff(w,h,[8]*3,6,strips,rows=rows,tables=tables),expected)
tiles, expected = [], Image.new('RGBA',(w,h))
for y in range(0,h,16):
    for x in range(0,w,16):
        data, decoded = jpeg(rgb.crop((x,y,x+16,y+16)))
        tiles.append(data); expected.paste(decoded,(x,y))
record('tiles',tiff(w,h,[8]*3,6,tiles,tiles=(16,16)),expected)
cmyk = Image.frombytes('CMYK',(w,h),bytes(v for y in range(h) for x in range(w) for v in ((x*7)%256,(y*11)%256,50,(x+y)%128)))
data, expected = jpeg(cmyk)
record('cmyk-adobe',tiff(w,h,[8]*4,5,[data]),expected)

for bits in (8,12,14,16):
    for psv in range(1,8):
        w,h = 17,9
        samples = [(x*187+y*917+(x*y*71)) % (1 << bits) for y in range(h) for x in range(w)]
        point, restart = (2,2) if psv == 7 else (0,0)
        data = lossless(w,h,bits,1,samples,psv,point,restart)
        values = [(v >> point) << point for v in samples]
        png = Image.frombytes('L',(w,h),bytes((v >> 8) if bits == 16 else round(v*255/((1 << bits)-1)) for v in values)).convert('RGBA')
        name = f'lossless{bits}-p{psv}'
        record(name,tiff(w,h,[bits],1,[data],little=psv%2==1),png)
        (out/(name+'.jpg')).write_bytes(data)
        raw_cases.append({'name':name, 'file':name+'.jpg', 'width':w, 'height':h, 'components':1, 'precision':bits, 'samples':values})
# Odd-width, multiple high-precision strips exercise row padding and output offsets.
for bits in (12,14,16):
    w,h,rows = 17,9,3
    samples = [(x*237+y*811)% (1<<bits) for y in range(h) for x in range(w)]
    strips = [lossless(w,rows,bits,1,samples[y*w:(y+rows)*w],4) for y in range(0,h,rows)]
    png = Image.frombytes('L',(w,h),bytes((v>>8) if bits==16 else round(v*255/((1<<bits)-1)) for v in samples)).convert('RGBA')
    record(f'lossless{bits}-strips',tiff(w,h,[bits],1,strips,rows=rows,little=False),png)
# DNG-like two-component sample stream: preserve samples, without promising RAW rendering.
w,h,bits,channels = 9,7,14,2
samples = [(x*1037)% (1<<bits) for x in range(w*h*channels)]
data = lossless(w,h,bits,channels,samples,6)
(out/'lossless14-two-components.jpg').write_bytes(data)
raw_cases.append({'name':'two-components','file':'lossless14-two-components.jpg','width':w,'height':h,'components':channels,'precision':bits,'samples':samples})
(out/'raw-two-components.tiff').write_bytes(tiff(w*channels,h,[bits],32803,[data]))
manifest = {'version':1,'license':'MIT','author':'Ilya Barilo',
            'tools':{'Pillow':PIL.__version__,'libjpeg_turbo':features.version_feature('libjpeg_turbo'),'libtiff':features.version('libtiff')},
            'cases':cases,'rawCases':raw_cases}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(f'Generated {len(cases)} TIFF cases and {len(raw_cases)} independent lossless JPEG cases.')
