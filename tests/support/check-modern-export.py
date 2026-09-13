"""Independent native decoding of browser exports; generated pixels only. MIT."""
import base64, io, json, sys
import PIL
from PIL import Image, features
import pillow_jxl
rows=json.load(sys.stdin);checks=[]
for row in rows:
 data=base64.b64decode(row['file']);im=Image.open(io.BytesIO(data));im.load()
 assert im.size==(row['width'],row['height']),(row['format'],im.size)
 pixels=im.convert('RGBA').tobytes();original=base64.b64decode(row['rgba'])
 exact=pixels==original
 if row['format'] in ('webpLossless','jxlLossless','tiff'): assert exact,(row['format'],'not lossless')
 if row['format']=='ico':
  # Canvas PNG export may round RGB of translucent pixels; no container loss.
  assert pixels[3::4]==original[3::4], 'ICO alpha differs'
  for i,(actual,expected) in enumerate(zip(pixels,original)):
   if original[i//4*4+3]==255: assert actual==expected, 'Opaque ICO sample differs'
   assert abs(actual-expected)*original[i//4*4+3]/255<=1.01, 'ICO differs beyond canvas rounding'
 result={'format':row['format'],'width':im.width,'height':im.height,'quality':row['quality'],'bytes':len(data),'exactRGBA':exact}
 if row['format']=='ico':
  sizes=sorted(im.ico.sizes());assert sizes==[(n,n) for n in [16,24,32,48,64,128,256]]
  for size in sizes: assert im.ico.getimage(size).size==size
  result['sizes']=[size[0] for size in sizes]
 if row['format']=='tiff':
  assert im.tag_v2[259]==8 and im.tag_v2[338]==(2,)
 checks.append(result)
print(json.dumps({'pillow':PIL.__version__,'libavif':features.version('avif'),'libwebp':features.version('webp'),'cases':checks}))
