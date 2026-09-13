// Synthetic JPEG/XMP fixture: no filesystem input, photographs or app encoders.
// APP1 and the expected GPano values are constructed independently of src/core/metadata.mjs.
const assert = require('node:assert/strict');

module.exports = async function panoramaFixture(page, { partial = false } = {}) {
  const jpeg = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 640;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 1280, 640);
    gradient.addColorStop(0, '#136a90'); gradient.addColorStop(1, '#f5ae42');
    context.fillStyle = gradient; context.fillRect(0, 0, 1280, 640);
    context.fillStyle = '#172c3a';
    for (let x = 0; x < 1280; x += 80) context.fillRect(x, 0, 3, 640);
    for (let y = 0; y < 640; y += 80) context.fillRect(0, y, 1280, 3);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }));
  assert.equal(jpeg.readUInt16BE(0), 0xffd8, 'fixture must start with JPEG SOI');
  const geometry = partial
    ? { fullWidth: 2560, fullHeight: 1280, left: 256, top: 128 }
    : { fullWidth: 1280, fullHeight: 640, left: 0, top: 0 };
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"
        GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True"
        GPano:CaptureSoftware="Synthetic GPano fixture"
        GPano:CroppedAreaImageWidthPixels="1280" GPano:CroppedAreaImageHeightPixels="640"
        GPano:FullPanoWidthPixels="${geometry.fullWidth}" GPano:FullPanoHeightPixels="${geometry.fullHeight}"
        GPano:CroppedAreaLeftPixels="${geometry.left}" GPano:CroppedAreaTopPixels="${geometry.top}" />
    </rdf:RDF>
  </x:xmpmeta>`;
  function app1(payload) {
    assert.ok(payload.length + 2 <= 65535);
    const header = Buffer.alloc(4); header.writeUInt16BE(0xffe1); header.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([header, payload]);
  }
  // Empty little-endian TIFF IFD: a valid EXIF segment to test its removal on export.
  const exif = app1(Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('49492a0008000000000000000000', 'hex')]));
  const xmp = app1(Buffer.from('http://ns.adobe.com/xap/1.0/\0' + xml));
  return { name: partial ? 'synthetic-cropped-panorama.jpg' : 'synthetic-panorama.jpg', mimeType: 'image/jpeg',
    buffer: Buffer.concat([jpeg.subarray(0, 2), exif, xmp, jpeg.subarray(2)]) };
};
