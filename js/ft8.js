// FT8 / FT4 receive decoder on the RX audio: 12 kHz resampling in an AudioWorklet, ft8_lib (WebAssembly) in a Worker,
// slots aligned to the PC clock (FT8: 15 s, UTC :00 / :15 / :30 / :45; FT4: 7.5 s). Decoding starts 14.4 s (FT8) /
// 6.3 s (FT4) into each slot. Transmit: the same Worker packs a message into tones; ft8Wave() makes the GFSK audio.
export const MODES = { FT8: { slot: 15000, decodeAt: 14400 }, FT4: { slot: 7500, decodeAt: 6300 } };
const base = new URL('./ft8/', import.meta.url);

// Channel waveform as WSJT-X's gen_ft8wave / gen_ft4wave: Gaussian-smoothed frequency (BT 2 for FT8, 1 for FT4),
// continuous phase, tone spacing = symbol rate. FT8: 79 tones, raised-cosine ramps over 1/8 symbol at both ends.
// FT4: 105 tones whose first and last are ramp symbols (the decoder's encode_tones fills them with the neighbouring
// tone), ramped over the whole symbol.
export function ft8Wave(tones, f0, rate, amp = 1, ft4 = false) {
  const nsps = Math.round(rate * (ft4 ? 0.048 : 0.16)), n = tones.length * nsps;
  const erf = (x) => { // Abramowitz-Stegun 7.1.26
    const sg = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return sg * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  const K = Math.PI * Math.sqrt(2 / Math.log(2)), bt = ft4 ? 1 : 2, hpk = (2 * Math.PI) / nsps;
  const pulse = new Float32Array(3 * nsps);
  for (let i = 0; i < pulse.length; i++) { const t = i / nsps - 1.5; pulse[i] = (erf(K * bt * (t + 0.5)) - erf(K * bt * (t - 0.5))) / 2; }
  // phase increment per sample; the first and last tones are extended by a dummy symbol on each side
  const dphi = new Float64Array(n + 2 * nsps).fill((2 * Math.PI * f0) / rate);
  tones.forEach((tone, s) => { for (let j = 0; j < 3 * nsps; j++) dphi[j + s * nsps] += hpk * tone * pulse[j]; });
  for (let j = 0; j < 2 * nsps; j++) {
    dphi[j] += hpk * pulse[j + nsps] * tones[0];
    dphi[j + tones.length * nsps] += hpk * pulse[j] * tones[tones.length - 1];
  }
  const out = new Float32Array(n), nr = ft4 ? nsps : Math.round(nsps / 8);
  let phi = 0;
  for (let k = 0; k < n; k++) {
    out[k] = amp * Math.sin(phi);
    phi = (phi + dphi[k + nsps]) % (2 * Math.PI);
  }
  for (let i = 0; i < nr; i++) { const w = (1 - Math.cos((Math.PI * i) / nr)) / 2; out[i] *= w; out[n - 1 - i] *= w; }
  return out;
}

export class Ft8Decoder extends EventTarget {
  constructor() {
    super();
    this.node = null; this.ctx = null;
    this.worker = new Worker(new URL('ft8-worker.js', base), { type: 'module' });
    this.worker.onmessage = ({ data: m }) => {
      if (m.type === 'decoded') this._decoded(m);
      else if (m.type === 'encoded') { this.encodes.get(m.id)?.(m); this.encodes.delete(m.id); }
    };
    this.encodes = new Map(); this.encId = 0;
    this.mode = 'FT8';
    this.cur = -1; this.collecting = false; this.decodedSlot = -1;
    this.txSlot = -1; // a slot we transmit in is not decoded (the RX audio then holds our own signal or nothing)
    this.timer = null;
  }
  get active() { return !!this.node; }
  get slot() { return MODES[this.mode].slot; }
  get ft4() { return this.mode === 'FT4'; }
  // switch protocol: the core is re-initialised and the slot being collected is dropped
  setMode(mode) {
    if (!MODES[mode] || mode === this.mode) return;
    this.mode = mode;
    this.worker.postMessage({ type: 'init', ft4: this.ft4 });
    this.cur = -1; this.collecting = false; this.txSlot = -1;
  }

  async start(ctx, src) {
    this.stop();
    await ctx.audioWorklet.addModule(new URL('ft8-worklet.js', base));
    const node = new AudioWorkletNode(ctx, 'ft8-resampler', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    node.port.onmessage = ({ data }) => { if (this.collecting) this.worker.postMessage({ type: 'samples', s: data.s }, [data.s.buffer]); };
    const sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(node); node.connect(sink).connect(ctx.destination);
    this.ctx = ctx; this.src = src; this.node = node; this.sink = sink;
    this.cur = -1; this.collecting = false;
    this.timer = setInterval(() => this._tick(), 50);
    this.dispatchEvent(new Event('state'));
  }
  stop() {
    if (!this.node) return;
    clearInterval(this.timer);
    for (const n of [this.node, this.sink]) { try { n.disconnect(); } catch {} }
    try { this.src.disconnect(this.node); } catch {}
    this.node = this.ctx = this.src = null;
    this.dispatchEvent(new Event('state'));
  }
  // message text -> { rc, text (as received), tones (Uint8Array(79), null when rc != 0) }
  encode(text) {
    const id = ++this.encId;
    return new Promise((res) => { this.encodes.set(id, res); this.worker.postMessage({ type: 'encode', id, text }); });
  }
  // seconds into the current slot (for the countdown)
  get secInSlot() { return (Date.now() % this.slot) / 1000; }

  _tick() {
    const SLOT = this.slot, now = Date.now(), slot = Math.floor(now / SLOT), t = now % SLOT;
    if (slot !== this.cur) {
      // new slot: collect from its beginning; a slot joined part-way (start-up) is skipped
      this.cur = slot;
      this.collecting = t < 1000;
      this.worker.postMessage({ type: 'reset' });
    }
    if (this.collecting && t >= MODES[this.mode].decodeAt && this.decodedSlot !== slot && this.txSlot !== slot) {
      this.decodedSlot = slot;
      this.worker.postMessage({ type: 'decode', slot, mode: this.mode });
    }
  }
  _decoded(m) {
    if (m.mode !== this.mode) return; // decoded before a protocol switch
    const start = new Date(m.slot * this.slot);
    const utc = `${String(start.getUTCHours()).padStart(2, '0')}${String(start.getUTCMinutes()).padStart(2, '0')}${String(start.getUTCSeconds()).padStart(2, '0')}`;
    // S/N and DT come from the decoder's fine synchronisation, on WSJT-X's scales
    const rows = m.list.map((r) => ({ slot: m.slot, utc, snr: Math.round(r.snr), dt: r.dt, freq: Math.round(r.freq), text: r.text }))
      .sort((a, b) => a.freq - b.freq);
    this.dispatchEvent(new CustomEvent('decoded', { detail: { slot: m.slot, utc, rows, blocks: m.blocks } }));
  }
}
