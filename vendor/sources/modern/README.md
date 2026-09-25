# WebP / JPEG XL source build

The original archives, selected source hashes and exact commits are recorded in
`sources.lock.json`. `scripts/prepare-modern.py` in the project reproduces the
selection from those upstream downloads without walking the workspace. Original
source bytes are unchanged; image fixtures are omitted. The `aom` record belongs
to the HEIC/AVIF module and is built by `../heic/build.py`, not this script.

Run with Python 3.12+, CMake 4.4.3, Ninja 1.13.2 and an activated portable
Emscripten 6.0.9 SDK (system installations need not be changed):

```text
python build.py --sdk PATH/emsdk --work PATH/modern-work --cmake PATH/cmake --ninja PATH/ninja --output PATH/modern-codecs.js
```

No sources or dependencies are downloaded by this command. The SDK must have
its compiler and standard runtime sources available. Build directories must be
separate from this source package. `--jobs` defaults to 4. Replace the project's
`vendor/modern-codecs.js`, then run `node scripts/build-vendor.cjs` and
`npm --prefix scripts run build`. The root HTML is rebuilt with the replacement.
The optional `--cache PATH` keeps Emscripten's generated system libraries on
the same drive as the SDK when the build work directory is on another drive.

`block-map.inc` is the project's small libjxl decoder extension. `build.py`
appends it to a freshly extracted `decode.cc`; the pinned upstream archive is
unchanged. It exposes the VarDCT strategy map for the first full, untransformed
frame. Modular images do not have that map.

The C interface accepts 8-bit straight RGBA up to 40 million pixels. A fresh
Worker owns the heap and is terminated after each operation. WebP has an
additional 16383-pixel per-axis format limit. Encoded buffers are capped at
256 MiB. JPEG XL uses effort 5, a single thread, and scalar Highway targets;
lossless preserves invisible RGB. Native browser canvas conversions may already
have changed source samples before they reach the encoder.

Own bridge/build code: MIT, see PROJECT-LICENSE. Third-party terms and complete
notices are in `../../MODERN-NOTICE` and the listed `modern-*` license files.
