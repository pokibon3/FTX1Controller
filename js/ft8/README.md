# FT8 decoder core

`ft8core.wasm` is built from [ft8_lib](https://github.com/kgoba/ft8_lib) (MIT, Kārlis Goba), vendored in
`wasm/ft8/ft8_lib/` (see its `VERSION`; one small patch exposes candidate LLRs), plus `wasm/ft8/api.c` /
`support.c`. Rebuild with `sh wasm/ft8/build.sh`.

On top of ft8_lib, `api.c` adds what WSJT-X does and ft8_lib does not:
fine time/frequency synchronisation of each candidate on a 200 Hz baseband (FFT downsampling), demodulation there,
OSD (ordered-statistics) decoding when belief propagation fails, and three passes with subtraction of decoded
signals. On ft8_lib's 27 test recordings this decodes 93 % of WSJT-X's messages (ft8_lib alone: 74 %), plus 20
plausible messages WSJT-X's reference run did not report.
