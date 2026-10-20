// FT8 receive decoder on the RX audio: 12 kHz resampling in an AudioWorklet, ft8_lib (WebAssembly) in a Worker,
// slots aligned to the PC clock (UTC :00 / :15 / :30 / :45). Decoding starts 14.4 s into each slot.
const SLOT = 15000, DECODE_AT = 14400;
const base = new URL('./ft8/', import.meta.url);

export class Ft8Decoder extends EventTarget {
  constructor() {
    super();
    this.node = null; this.ctx = null;
    this.worker = new Worker(new URL('ft8-worker.js', base), { type: 'module' });
    this.worker.onmessage = ({ data: m }) => { if (m.type === 'decoded') this._decoded(m); };
    this.cur = -1; this.collecting = false; this.decodedSlot = -1;
    this.timer = null;
  }
  get active() { return !!this.node; }

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
  // seconds into the current slot (for the countdown)
  get secInSlot() { return (Date.now() % SLOT) / 1000; }

  _tick() {
    const now = Date.now(), slot = Math.floor(now / SLOT), t = now % SLOT;
    if (slot !== this.cur) {
      // new slot: collect from its beginning; a slot joined part-way (start-up) is skipped
      this.cur = slot;
      this.collecting = t < 1000;
      this.worker.postMessage({ type: 'reset' });
    }
    if (this.collecting && t >= DECODE_AT && this.decodedSlot !== slot) {
      this.decodedSlot = slot;
      this.worker.postMessage({ type: 'decode', slot });
    }
  }
  _decoded(m) {
    const start = new Date(m.slot * SLOT);
    const utc = `${String(start.getUTCHours()).padStart(2, '0')}${String(start.getUTCMinutes()).padStart(2, '0')}${String(start.getUTCSeconds()).padStart(2, '0')}`;
    // ft8_lib reports a sync score; this maps it roughly onto WSJT-X's S/N scale (calibrated on ft8_lib's test files).
    // DT: ft8_lib's start time minus the 0.5 s nominal offset and the measured ~0.15 s analysis lag.
    const rows = m.list.map((r) => ({ utc, snr: Math.max(-24, Math.min(30, Math.round(r.score * 0.9 - 29))), dt: r.dt - 0.65, freq: Math.round(r.freq), text: r.text }))
      .sort((a, b) => a.freq - b.freq);
    this.dispatchEvent(new CustomEvent('decoded', { detail: { utc, rows, blocks: m.blocks } }));
  }
}
