# HEIC / AVIF: corresponding sources and rebuilding

This package accompanies Image Format Lab (https://github.com/IlyaBarilo/image-format-lab).
It contains the exact library
sources used for its HEIC/AVIF decoder and encoder, an MIT bridge, build scripts, license texts
and a tool to replace the codec in the supplied standalone HTML.

## Components and terms

- Kvazaar 2.3.2: BSD-3-Clause, with the retained public-domain MD5 notice.
- libheif 1.23.4 and libde265 1.1.2: LGPL-3.0-or-later. Their COPYING files
  include LGPLv3 and GPLv3. File-level notices remain in the source archives.
- `bridge.cpp`, Python helpers and `relink.mjs`: Copyright (c) 2026 Ilya Barilo,
  MIT; see `PROJECT-LICENSE`.
- Generated Emscripten glue, emmalloc, musl and LLVM C/C++ runtime portions
  retain their own permissive terms; see `licenses/HEIC-NOTICE` and adjacent texts.

The original application HTML is the Corresponding Application Code used by
`relink.mjs`. Keep it together with this package. You may modify the libraries,
recombine them with the application and debug those modifications. No signature,
activation key or authorization service is required. These instructions implement
the source/recombination route described in LGPLv3 section 4(d)(0).

The four source tarballs contain the library source/build files needed for this
configuration, with unmodified upstream file bytes. Upstream example images,
tests and unrelated optional dependencies were omitted. `sources.lock.json`
records release URLs, original release SHA-256, supplied archive SHA-256 and
selection. Kvazaar encodes HEVC and libaom encodes AV1; no x265, heic2any or gifshot is linked.

## Prepare the tools once

Use Python 3.12 or newer, Node.js (tested with 24.16.0), CMake 4.4.3,
Ninja 1.13.2 and Emscripten 6.0.9. A C/C++ SDK is large and is not embedded
in the application. Tool installation needs internet; the build itself uses the
included library sources. An already populated Emscripten cache allows offline
rebuilding. Toolchain details are in `sources.lock.json`.

Get the emsdk checkout at commit
`5eb0bde7585670252e8ba05e9d361627bffd08b5` from
<https://github.com/emscripten-core/emsdk>. From that directory run:

```text
python emsdk.py install 6.0.9
python emsdk.py activate 6.0.9
```

Use an activated SDK directory, without `--permanent` or system installation.
On Windows its pinned SDK release is
`f04ea239d533260dd1db760dd2d668d5f9a88d6b`.
Do not run upstream `build-emscripten.sh`: this package uses its own CMake recipe.

## Build, modify and recombine

Extract this ZIP to a writable directory. From `heic-sources/`:

```text
python build.py --sdk /path/to/emsdk --work /path/to/heic-work --output /path/to/rebuilt-heic.js
```

Use absolute tool paths with `--cmake` and `--ninja` if they are not in PATH.
`--jobs 4` controls compilation concurrency. A `.map` beside the JS records
linked objects. The output includes WASM and has no runtime file dependencies.
Library objects are rebuilt with `--clean-first`: copied source timestamps cannot
silently leave objects from a previous source revision in the decoder.

Edit `heic-work/libheif-1.23.4/`, `heic-work/libde265-1.1.2/` or `heic-work/kvazaar-2.3.2/`, preserve existing
notices and mark changed files with the date and nature of your modifications.
Edit `bridge.cpp` here if the bridge is being changed. Then:

```text
python build.py --sdk /path/to/emsdk --work /path/to/heic-work --reuse-sources --output /path/to/rebuilt-heic.js
python export-sources.py --work /path/to/heic-work --note "Describe your modifications"
python package.py --output /path/to/updated-sources.zip
node relink.mjs /path/to/original.html /path/to/rebuilt-heic.js /path/to/updated-sources.zip /path/to/modified.html
```

`export-sources.py` reads only explicit entries from the original source
archives; it does not scan directories. For a newly added file use
`--add libde265-1.1.2/libde265/new-file.cc` (repeat as needed). Amend the CMake
inputs when adding compilation units. Keep intentionally removed source files
as documented empty placeholders or update the package helper explicitly.
`--reuse-sources` is essential when building edits: without it the pristine
package archives are extracted again.

Open `modified.html` directly. All codec operations remain offline. The updated
source ZIP stays separate; its bytes are never inserted into the HTML. Its name
and SHA-256 are recorded in Licenses. Executable HEIC/AVIF code may be stored
as gzip-base64 inside HTML; relink preserves that storage mode and records
the uncompressed module size. Plain-JavaScript HTML remains supported.
The application unpacks executable code automatically, without network access.
Without an extra option, relink clears the
old source URL and labels the result as a local build. Before distributing it
online, publish the corresponding modified ZIP and add
`--source-url=https://your-host/version/updated-sources.zip` to the command
(replace this illustrative address with the real download URL).
The tool does not upload files or check remote availability. It accepts the new
separate-source HTML layout; older HTML needs its original relink tool.
Original HTML and existing output files are not overwritten. The code uses the same
`ViewerHeicModule` factory and exported bridge functions; preserve that API for
replacement, or update the MIT application sources as well.

## Scope and limits

Decoding is HEVC only, selects the primary image and returns straight RGBA8.
HEIF rotation/mirror/crop properties are applied. Alpha is retained. High-bit-depth
input is reduced to 8-bit output; the application is not an HDR reference viewer
and does not preserve arbitrary ICC/EXIF metadata in conversions. Other HEIF
codecs are disabled. HEIC encoding uses Kvazaar 2.3.2: HEVC 8-bit 4:2:0,
quality 1–100, sRGB primaries/transfer, full-range BT.601 matrix and optional
auxiliary alpha. Quality 100 is not lossless RGB; alpha may also be lossy.
The output is a still `.heic` image, without Live Photos, HDR or camera metadata. The bridge restricts dimensions to
40 million pixels. The application also caps input at 256 MiB and terminates the
Worker after each encoded/decoded image or error. These limits are not a promise of a
particular browser peak memory use.

In the full project, copy a rebuilt codec to `vendor/heic-decoder.js`, rebuild
`vendor/heic-sources.zip` with `package.py`, run `node scripts/build-vendor.cjs`,
then `npm --prefix scripts run build`. The ordinary HTML build uses the committed JS/ZIP and
does not invoke a C++ compiler. Configure both source ZIP URLs in
`scripts/source-release.json`, then use `npm --prefix scripts run build:release` for a public
release; the command fails if a URL is missing. Publish the exact ZIPs alongside
the HTML with equivalent access at no additional charge and clear directions
next to the HTML download. Maintain access to the corresponding version;
linking only to a moving branch or promising a later upload is insufficient.
The build checks local source integrity and URL syntax, not remote availability.
For physical redistribution, choose and satisfy an applicable source delivery
option; these instructions describe online distribution under GPLv3 6(d).

## AVIF

The same module now includes libaom 3.15.0 for AVIF encoding and decoding. Its
selected source archive and notices are in this kit. Build requires Perl 5
for upstream RTCD generation; pass `--perl PATH/perl` if not on PATH. On Windows
the Perl supplied with Git for Windows can be used. AOM is scalar, single-threaded,
without libyuv/libwebm/apps/tests or Butteraugli tuning. The original HEIC ABI
remains available; AVIF adds `viewer_avif_encode` and `viewer_avif_can_encode`.
Recombination updates the complete HEIC/AVIF module and its source archive.
