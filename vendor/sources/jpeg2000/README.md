# OpenJPEG source build

The unmodified `upstream/openjpeg-v2.5.4.tar.gz` is the official OpenJPEG v2.5.4 source archive from `https://github.com/uclouvain/openjpeg/archive/refs/tags/v2.5.4.tar.gz`. SHA-256: `a695fbe19c0165f295a8531b1e4e855cd94d0875d2f88ec4b61080677e27188a`.

`build.py` verifies the archive and extracts it into the supplied work directory. It builds only the `openjp2` library, without the CLI tools or their image-file dependencies, then links the project-owned `bridge.c` into `jpeg2000-codec.js`. Nothing is downloaded during this build. Example from the repository root:

```text
python vendor/sources/jpeg2000/build.py --sdk PATH/emsdk --work PATH/jpeg2000-work --cmake PATH/cmake --ninja PATH/ninja --output vendor/jpeg2000-codec.js
```

Use Python 3.13+, CMake, Ninja and the portable Emscripten 6.0.9 SDK already used for the other codecs. The module operates in a disposable Worker and accepts JP2/J2K Part 1 with unsigned, unsampled 8- or 16-bit Gray/RGB/RGBA. Image limits are 8 Mi pixels for 8-bit samples and 4 Mi pixels for 16-bit samples; encoded input is capped at 64 MiB. Unsupported component layouts fail explicitly. Quality 100 uses the reversible lossless transform; lower values select a target compression ratio with the irreversible transform. The latter is an approximate rate target, not a PSNR guarantee.

OpenJPEG: BSD-2-Clause; see `../../openjpeg-LICENSE` and `../../OPENJPEG-NOTICE`. The project-owned bridge/build files are MIT; see `PROJECT-LICENSE`. The generated Emscripten runtime retains its MIT notice.
