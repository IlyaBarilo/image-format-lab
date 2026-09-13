# gifenc 1.0.3 — corresponding JavaScript sources

The eight src/ modules come from gifenc's npm release commit
15e2c3e65ed03c977b42fec48de59b05ee9b9f54:
https://github.com/mattdesl/gifenc/tree/15e2c3e65ed03c977b42fec48de59b05ee9b9f54/src

src/pnnquant2.js derives from PnnQuant.js and is provided under MPL-2.0.
The upstream MIT notice for gifenc and its modifications is also preserved;
it does not replace PnnQuant's MPL. Only a license header was added to that module;
no algorithms were changed. Other modules retain their MIT conditions and credits.
See LICENSE, MPL-2.0, gif-js-LICENSE, gif-codec-LICENSE and NOTICE.md.
The build.cjs helper, this README and packaging metadata were added by the
Image Format Lab project and are MIT under PROJECT-LICENSE
(Copyright 2026 Ilya Barilo). This does not change the upstream module licenses.

PnnQuant MPL source:
https://github.com/takase1121/PnnQuant.js/tree/1a8577ad21bcd3871dc5c90a6d880ae0074c5389

## Build / modify

With Node.js and npm installed, run in this directory:

```sh
npm install
npm run build
```

This produces gifenc.cjs from the supplied, editable modules with esbuild 0.28.2.
Initial installation of esbuild requires network access. The source modules are
included here and do not need to be retrieved from GitHub.

In the Image Format Lab repository, edit these modules, then run from its root:

```sh
node scripts/build-vendor.cjs
npm --prefix scripts run build
```

The first command uses this same build.cjs helper to produce the CommonJS codec,
browser wrapper, separate gifenc-1.0.3-sources.zip and explicit integrity manifest.
The second embeds the working codec, notices and source-package metadata into
the standalone HTML. The application's MIT terms
do not restrict modification of these libraries.

The viewer's Лицензии window links to this separate package when its publication
URL is configured in scripts/source-release.json. An unconfigured local build
reports that sources have not yet been published. Publish the exact ZIP alongside
the HTML, at no additional charge, with a stable URL for that version. Running
the viewer needs no internet; downloading sources from that URL does.
The ZIP contains the preferred source form, license texts and build instructions.
This package is not a source distribution for HEIC or UTIF.
