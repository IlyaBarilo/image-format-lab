// Copyright (c) 2026 Ilya Barilo. MIT; see ../LICENSE.
// Explicit one-file transformation of the pinned upstream. The unmodified
// input is not a release artifact: the old embedded JPEG code is not shipped.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { parse } = require('acorn');
const root = path.resolve(__dirname, '..');
function prepare(source) {
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'vendor/sources/utif/upstream.json')));
  if (hash !== lock.sha256) throw new Error('Unexpected UTIF upstream revision');
  let text = source.toString('utf8');
  const begin = text.indexOf('// Following lines add a JPEG decoder');
  const end = text.indexOf('UTIF.encodeImage =');
  if (begin < 0 || end < begin) throw new Error('Missing embedded JPEG block');
  text = text.slice(0, begin) + text.slice(end);
  const removed = new Set(['UTIF.LosslessJpegDecode', 'UTIF.decode._decodeNewJPEG',
    'UTIF.decode._decodeOldJPEGInit', 'UTIF.decode._decodeOldJPEG']);
  const ranges = [];
  function visit(node) {
    // Image display does not use camera MakerNotes. Their private directory
    // offsets bypass standard TIFF directory validation, so do not follow them.
    if (node.type === 'IfStatement' && text.slice(node.test.start, node.test.end) === 'tag==37500')
      ranges.push([node.start, node.end]);
    if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression') {
      const key = text.slice(node.expression.left.start, node.expression.left.end);
      if (removed.has(key)) { ranges.push([node.start, node.end]); removed.delete(key); }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child?.type) visit(child); }
      else if (value?.type) visit(value);
    }
  }
  visit(parse(text, { ecmaVersion: 'latest' }));
  if (removed.size) throw new Error('Missing UTIF functions: ' + [...removed]);
  for (const [start, end] of ranges.sort((a,b) => b[0] - a[0])) text = text.slice(0, start) + text.slice(end);
  // JPEG compressed length can coincidentally equal the output buffer size.
  text = text.replace('(len==tgt.length && cmpr!=32767)', '(len==tgt.length && cmpr!=32767 && cmpr!=6 && cmpr!=7)');
  // With four CMYK samples, reading the nonexistent next alpha yields NaN at
  // the last pixel even when multiplied by zero. The output is opaque.
  text = text.replace('255*(1-gotAlpha)+data[si+4]*gotAlpha', 'gotAlpha ? data[si+4] : 255');
  text = text.replace('else if(tag==330 || tag==34665 || (tag==50740 && bin.readUshort(data,bin.readUint(arr,0))<300  ))', 'else if(tag==330 || tag==34665)');
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return '// UTIF 3.1.0, Copyright (c) 2017 Photopea. MIT; see UTIF-LICENSE.\n' +
    '// Modified by Ilya Barilo: embedded JPEG implementations and\n' +
    '// old JPEG container adapters removed; compression dispatch and CMYK alpha corrected.\n' +
    '// Private MakerNote/DNG-directory recursion disabled for image display.\n' +
    '// JPEG adapters are supplied by src/core/tiff-jpeg.mjs. See UTIF-JPEG-NOTICE.\n' + text;
}
if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/prepare-utif.cjs <pinned upstream UTIF.js>');
  const text = prepare(fs.readFileSync(process.argv[2]));
  fs.writeFileSync(path.join(root, 'vendor/sources/utif/UTIF.js'), text);
  console.log('Prepared UTIF TIFF source without the two embedded JPEG decoders.');
}
module.exports = { prepare };
