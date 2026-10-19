// CW decoder on the FTX-1 RX audio.
// The DSP / decoder is the cw_decoder4 WebAssembly core running in an AudioWorklet (js/cwdec/);
// this module only wires it to the RX AudioContext and turns its frames into text.
// Signal chain follows cw_decoder4/web: channel pick -> input BPF (Q=3, tracks the tone) -> worklet.

// status[] indices (cw_decoder4 web/wasm/api.cpp cw_status_t)
const ST = { charN: 4, wpm: 5, toneHz: 6, toneAuto: 8, mode: 15, gate: 16, clip: 17 };
const BPF_Q = 3;

// JIS X 0201 kana -> full-width katakana (same table as cw_decoder4 display.cpp)
const KANA_CP = [
  0x3002, 0x300C, 0x300D, 0x3001, 0x30FB, 0x30F2,
  0x30A1, 0x30A3, 0x30A5, 0x30A7, 0x30A9,
  0x30E3, 0x30E5, 0x30E7, 0x30C3, 0x30FC,
  0x30A2, 0x30A4, 0x30A6, 0x30A8, 0x30AA,
  0x30AB, 0x30AD, 0x30AF, 0x30B1, 0x30B3,
  0x30B5, 0x30B7, 0x30B9, 0x30BB, 0x30BD,
  0x30BF, 0x30C1, 0x30C4, 0x30C6, 0x30C8,
  0x30CA, 0x30CB, 0x30CC, 0x30CD, 0x30CE,
  0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB,
  0x30DE, 0x30DF, 0x30E0, 0x30E1, 0x30E2,
  0x30E4, 0x30E6, 0x30E8,
  0x30E9, 0x30EA, 0x30EB, 0x30EC, 0x30ED,
  0x30EF, 0x30F3, 0x309B, 0x309C,
];
const DAKUTEN_OK = new Set([
  0x30A6, 0x30AB, 0x30AD, 0x30AF, 0x30B1, 0x30B3, 0x30B5, 0x30B7, 0x30B9, 0x30BB, 0x30BD,
  0x30BF, 0x30C1, 0x30C4, 0x30C6, 0x30C8, 0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB,
]);
const HANDAKUTEN_OK = new Set([0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB]);

function codepointOf(ch) {
  if (ch === 5) return 0x300C; // ホレ -> 「
  if (ch === 6) return 0x300D; // ラタ -> 」
  if (ch >= 0xA1 && ch <= 0xDF) return KANA_CP[ch - 0xA1];
  if (ch < 0x80) return ch;
  return 0x2A; // '*'
}

const base = new URL('./cwdec/', import.meta.url);

export class CwDecoder extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.node = null;
    this.chain = [];
    this.bpf = null;
    this.status = null;
    this.chars = [];
    this.channel = 'L';
    this.wasm = null; // cached bytes (transferred copies are sent to each worklet)
  }

  get active() { return !!this.node; }
  get text() { return String.fromCodePoint(...this.chars); }
  get wpm() { return this.status?.[ST.wpm] || 0; }
  get toneHz() { return this.status?.[ST.toneHz] || 0; }
  get toneAuto() { return !!this.status?.[ST.toneAuto]; }
  get jp() { return !!this.status?.[ST.mode]; }
  get gate() { return !!this.status?.[ST.gate]; }

  // Attach to an RX AudioContext / source node. The worklet must live in the same context,
  // so this is called again whenever RX audio is restarted.
  async start(ctx, src) {
    this.stop();
    if (!ctx.audioWorklet) throw new Error('AudioWorklet が使えません（https か localhost で開いてください）');
    if (!this.wasm) this.wasm = await (await fetch(new URL('cwcore.wasm', base))).arrayBuffer();
    await ctx.audioWorklet.addModule(new URL('cw-worklet.js', base));
    // explicit mono, or inputs[0][0] would be the left channel only
    const node = new AudioWorkletNode(ctx, 'cw-processor', {
      numberOfInputs: 1, numberOfOutputs: 1,
      channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    });
    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('cwcore.wasm の読み込みに失敗しました')), 10000);
      node.port.onmessage = (e) => {
        if (e.data.type === 'ready') { clearTimeout(t); resolve(); }
        else if (e.data.type === 'frame') this._onFrame(e.data);
      };
    });
    const bytes = this.wasm.slice(0);
    node.port.postMessage({ type: 'wasm', bytes }, [bytes]);
    // the worklet outputs nothing, but some engines only call process() when it reaches the destination
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    this.ctx = ctx; this.src = src; this.node = node; this.sink = sink;
    this._wire();
    await ready;
    this.dispatchEvent(new Event('state'));
  }

  stop() {
    if (!this.node) return;
    for (const n of [...this.chain, this.node, this.sink]) { try { n.disconnect(); } catch {} }
    try { this.src.disconnect(this.chain[0] || this.node); } catch {}
    this.chain = []; this.bpf = null; this.node = null; this.ctx = null; this.src = null;
    this.dispatchEvent(new Event('state'));
  }

  setChannel(ch) { this.channel = ch; if (this.node) this._wire(); }
  toggleMode() { this.node?.port.postMessage({ type: 'toggleMode' }); }
  cycleTone() { this.node?.port.postMessage({ type: 'cycleTone' }); }
  setToneHz(hz) { this.node?.port.postMessage({ type: 'toneHz', hz: Math.round(hz) }); }
  setGain(db) { this.node?.port.postMessage({ type: 'gain', value: Math.pow(10, db / 20) }); }
  clear() { this.chars = []; this.dispatchEvent(new Event('text')); }

  _wire() {
    const { ctx, src } = this;
    for (const n of this.chain) { try { n.disconnect(); } catch {} }
    try { src.disconnect(this.chain[0] || this.node); } catch {}
    this.chain = [];
    let out = src;
    if (this.channel !== 'MIX') {
      const sp = ctx.createChannelSplitter(2);
      const g = ctx.createGain();
      src.connect(sp);
      sp.connect(g, this.channel === 'R' ? 1 : 0, 0);
      this.chain.push(sp, g);
      out = g;
    }
    // input BPF: the decoder's relative squelch was tuned behind the firmware's analog BPF
    this.bpf = ctx.createBiquadFilter();
    this.bpf.type = 'bandpass';
    this.bpf.frequency.value = this._bpfCenter();
    this.bpf.Q.value = BPF_Q;
    out.connect(this.bpf);
    this.chain.push(this.bpf);
    this.bpf.connect(this.node);
    this.node.port.postMessage({ type: 'reset' });
  }

  _bpfCenter() {
    const hz = this.toneHz;
    return hz >= 400 && hz <= 1200 ? hz : 700;
  }

  _onFrame(m) {
    this.status = m.status;
    const nc = m.status[ST.charN];
    if (nc) {
      for (let i = 0; i < nc; i++) this._putChar(m.chars[i * 8 + 4]);
      this.dispatchEvent(new Event('text'));
    }
    if (this.bpf && this.ctx) {
      const f = this._bpfCenter();
      if (Math.abs(this.bpf.frequency.value - f) >= 1) this.bpf.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    }
  }

  _putChar(byte) {
    const cp = codepointOf(byte);
    // merge dakuten / handakuten into the previous kana (カ + ゛ -> ガ)
    if ((cp === 0x309B || cp === 0x309C) && this.chars.length) {
      const prev = this.chars[this.chars.length - 1];
      let comb = 0;
      if (cp === 0x309B && DAKUTEN_OK.has(prev)) comb = prev === 0x30A6 ? 0x30F4 : prev + 1;
      else if (cp === 0x309C && HANDAKUTEN_OK.has(prev)) comb = prev + 2;
      if (comb) { this.chars[this.chars.length - 1] = comb; return; }
    }
    this.chars.push(cp);
    if (this.chars.length > 4000) this.chars = this.chars.slice(-3000);
  }
}
