# FT8 decoder core

`ft8core.wasm` is built from [ft8_lib](https://github.com/kgoba/ft8_lib) (MIT, Kārlis Goba), vendored in
`wasm/ft8/ft8_lib/` (see its `VERSION`), plus `wasm/ft8/api.c` / `support.c`. Rebuild with `sh wasm/ft8/build.sh`.
Decodes of ft8_lib's test recordings match its native `decode_ft8` exactly.
