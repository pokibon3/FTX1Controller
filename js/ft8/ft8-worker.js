// FT8 decoder worker: owns the WebAssembly core (ft8_lib) so a decode never stalls the UI.
let e = null, bs = 0, pending = new Float32Array(0);
const ready = (async () => {
  const { instance } = await WebAssembly.instantiate(await (await fetch(new URL('ft8core.wasm', import.meta.url))).arrayBuffer(), {});
  e = instance.exports; e.ft8_init(); bs = e.ft8_block_size();
})();
onmessage = async ({ data: m }) => {
  await ready;
  if (m.type === 'samples') {
    const all = new Float32Array(pending.length + m.s.length); all.set(pending); all.set(m.s, pending.length);
    let p = 0;
    for (; p + bs <= all.length; p += bs) { new Float32Array(e.memory.buffer, e.ft8_block_ptr(), bs).set(all.subarray(p, p + bs)); e.ft8_process(); }
    pending = all.slice(p);
  } else if (m.type === 'reset') {
    e.ft8_reset(); pending = new Float32Array(0);
  } else if (m.type === 'decode') {
    const blocks = e.ft8_blocks();
    const n = blocks > 40 ? e.ft8_decode() : 0;
    const rs = e.ft8_result_size(), rp = e.ft8_results_ptr(), out = [];
    for (let i = 0; i < n; i++) {
      const dv = new DataView(e.memory.buffer, rp + i * rs, rs);
      const tb = new Uint8Array(e.memory.buffer, rp + i * rs + 16, 40);
      out.push({ snr: dv.getFloat32(0, true), dt: dv.getFloat32(4, true), freq: dv.getFloat32(8, true), text: new TextDecoder().decode(tb.subarray(0, tb.indexOf(0))) });
    }
    postMessage({ type: 'decoded', slot: m.slot, blocks, list: out });
  }
};
