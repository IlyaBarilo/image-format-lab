# JPEG decoder build sources

The viewer uses libjpeg-turbo 3.2.0 through the libjpeg C API. The original
baseline/progressive and lossless JPEG implementations formerly embedded in
UTIF are removed. Our bridge and JS adapters are MIT; libjpeg-turbo retains
its IJG/BSD-style terms. This software is based in part on the work of the
Independent JPEG Group.

`sources.lock.json` pins the official upstream archive and the selected source
archive. The selection preserves file bytes and omits upstream images and
unneeded optional components. `scripts/prepare-jpeg-sources.py` in the repository
recreates it from the verified official archive. No upstream C files are patched.
The original archive is not part of this source package.

Install Emscripten 6.0.9, CMake 4.4.3, Ninja 1.13.2 and Python 3.12+ separately.
With those tools available, the following build reads only the supplied inputs:

```sh
python vendor/sources/jpeg/build.py --sdk /path/to/emsdk --work /path/to/jpeg-build --output /path/to/jpeg-build/jpeg-decoder.js
```

Use `--cmake` and `--ninja` for non-PATH executables. Builds clean the target
before compiling to avoid stale objects from archived timestamps. No libraries
are downloaded by the build script. It generates an embedded-WASM JS module and
a link map. The bridge uses a pinned internal field (`master->lossless`); upgrades
must recheck this along with the public 8/12/16-bit scanline APIs.

To integrate a rebuilt decoder, copy its JS to `vendor/jpeg-decoder.js`, update
applicable notices with `scripts/collect-jpeg-notices.py`, run
`node scripts/build-vendor.cjs`, then `npm --prefix scripts run build` and `npm --prefix scripts test`.
The source archive is supplied in the repository for reproducibility, not loaded
by the browser. The single HTML embeds the decoder and all applicable notices.
Unlike the HEIC LGPL source bundle, this permissively licensed source package
does not need to be embedded into every HTML copy.

The build disables TurboJPEG, tools, tests and platform SIMD. The final link
keeps the decoding paths referenced by `bridge.c`, without PNG/libspng, encoders,
or external file access. Our independent JPEG/TIFF tests validate this specific
build instead of claiming that the upstream suite was run.

The Worker bounds inputs to 256 MiB and images to 40 megapixels and is destroyed
after each operation. These limits are not a promise of peak physical memory.
Hierarchical JPEG, DNL and some unusual lossless layouts are unsupported by
libjpeg-turbo. TIFF sensor data does not imply a complete RAW/DNG renderer.
