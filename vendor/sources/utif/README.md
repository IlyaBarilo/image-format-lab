# Adapted UTIF 3.1.0

`UTIF.js` is the maintained TIFF source used by this application. It is based on
the exact Photopea revision in `upstream.json` and retains Photopea's MIT terms
in `../../UTIF-LICENSE`. Modifications by Ilya Barilo:

- Removed the minified ordinary JPEG IIFE and `UTIF.LosslessJpegDecode`.
- Removed the former JPEG-in-TIFF adapters. Own adapters now live in
  `src/core/tiff-jpeg.mjs` and call a libjpeg-turbo WASM decoder.
- Prevented a JPEG strip with compressed length equal to the output buffer from
  being mistaken for uncompressed data.
- Fixed the last CMYK pixel's opacity when there is no alpha channel.
- Disabled automatic recursion into private camera MakerNote/DNG directories,
  which the viewer does not use and which bypass standard TIFF field validation.

`node scripts/prepare-utif.cjs <original-UTIF.js>` recreates the adaptation from
the pinned original file after verifying its SHA-256. That original file is not
included in the public package. The application build uses this adapted source;
`node scripts/build-vendor.cjs` copies it to `vendor/UTIF-3.1.0.js` and regenerates
the vendor integrity manifest. Edit this source and the preparation script
together when changing the adaptation.

The TIFF Worker supplies bounds checks and runs these APIs away from the main UI.
The application does not call UTIF's URL-loading/DOM convenience helpers.
