// USB audio routing for the FTX-1 "USB Audio CODEC":
//   RX: radio codec input -> speakers (+ AF-FFT analyser, recorder)
//   TX: PC microphone -> radio codec output, gated by PTT

const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

export const isRadioDevice = (d) => /USB Audio (CODEC|Device)|FTX|YAESU/i.test(d.label);

function rms(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    sum += x * x;
    if (Math.abs(x) > peak) peak = Math.abs(x);
  }
  return { rms: Math.sqrt(sum / buf.length), peak };
}

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.rx = null;
    this.tx = null;
    this.recorder = null;
    this._tbuf = new Float32Array(2048);
    navigator.mediaDevices?.addEventListener('devicechange', () => this.dispatchEvent(new Event('devicechange')));
  }

  async unlockLabels() {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    st.getTracks().forEach((t) => t.stop());
  }

  async devices() {
    const list = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: list.filter((d) => d.kind === 'audioinput'),
      outputs: list.filter((d) => d.kind === 'audiooutput'),
    };
  }

  static async _ctx(sinkId) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (sinkId && sinkId !== 'default') {
      if (!ctx.setSinkId) throw new Error('このChromeは出力デバイス選択(setSinkId)に未対応です');
      await ctx.setSinkId(sinkId);
    }
    return ctx;
  }

  static _mic(deviceId) {
    return navigator.mediaDevices.getUserMedia({
      audio: { ...RAW_AUDIO, deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 2 } },
    });
  }

  // ---- RX ----
  async startRx({ inputId, outputId, volume = 0.8, muted = false }) {
    await this.stopRx();
    const ctx = await AudioEngine._ctx(outputId);
    const stream = await AudioEngine._mic(inputId);
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -20;
    const gain = ctx.createGain();
    gain.gain.value = muted ? 0 : volume;
    const recDest = ctx.createMediaStreamDestination();
    src.connect(analyser);
    src.connect(gain).connect(ctx.destination);
    src.connect(recDest);
    if (ctx.state === 'suspended') await ctx.resume();
    this.rx = { ctx, stream, src, analyser, gain, recDest, volume, muted };
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stopRx());
    this.dispatchEvent(new Event('state'));
  }

  async stopRx() {
    this.stopRecording();
    if (!this.rx) return;
    this.rx.stream.getTracks().forEach((t) => t.stop());
    await this.rx.ctx.close().catch(() => {});
    this.rx = null;
    this.dispatchEvent(new Event('state'));
  }

  setRxVolume(v) {
    if (!this.rx) return;
    this.rx.volume = v;
    if (!this.rx.muted) this.rx.gain.gain.setTargetAtTime(v, this.rx.ctx.currentTime, 0.02);
  }

  setRxMute(m) {
    if (!this.rx) return;
    this.rx.muted = m;
    this.rx.gain.gain.setTargetAtTime(m ? 0 : this.rx.volume, this.rx.ctx.currentTime, 0.02);
  }

  rxLevel() { return this.rx ? rms(this.rx.analyser, this._tbuf) : null; }
  get rxAnalyser() { return this.rx?.analyser || null; }
  get rxSampleRate() { return this.rx?.ctx.sampleRate || 48000; }

  // ---- TX ----
  async startTx({ micId, outputId, gain = 1 }) {
    await this.stopTx();
    if (!outputId || outputId === 'default') throw new Error('TX出力にFTX-1のUSB Audio CODECを選択してください');
    const ctx = await AudioEngine._ctx(outputId);
    const stream = await AudioEngine._mic(micId);
    const src = ctx.createMediaStreamSource(stream);
    const micGain = ctx.createGain();
    micGain.gain.value = gain;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    osc.connect(toneGain);
    osc.start();
    const gate = ctx.createGain();
    gate.gain.value = 0;
    src.connect(micGain);
    micGain.connect(analyser);
    toneGain.connect(analyser);
    micGain.connect(gate);
    toneGain.connect(gate);
    gate.connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();
    this._txGain = gain;
    this.tx = { ctx, stream, micGain, analyser, gate, toneGain, osc, tone: false };
    this.dispatchEvent(new Event('state'));
  }

  async stopTx() {
    if (!this.tx) return;
    this.tx.stream.getTracks().forEach((t) => t.stop());
    await this.tx.ctx.close().catch(() => {});
    this.tx = null;
    this.dispatchEvent(new Event('state'));
  }

  setTxGain(g) {
    this._txGain = g;
    if (this.tx && !this.tx.tone) this.tx.micGain.gain.setTargetAtTime(g, this.tx.ctx.currentTime, 0.02);
  }

  setTxOpen(open) {
    if (!this.tx) return;
    this.tx.gate.gain.setTargetAtTime(open ? 1 : 0, this.tx.ctx.currentTime, 0.005);
  }

  setTone(on) {
    if (!this.tx) return;
    this.tx.tone = on;
    this.tx.micGain.gain.setTargetAtTime(on ? 0 : (this._txGain ?? 1), this.tx.ctx.currentTime, 0.01);
    this.tx.toneGain.gain.setTargetAtTime(on ? 0.5 : 0, this.tx.ctx.currentTime, 0.01);
  }

  txLevel() { return this.tx ? rms(this.tx.analyser, this._tbuf) : null; }

  // ---- recording ----
  startRecording() {
    if (!this.rx || this.recorder) return false;
    const mime = ['audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(this.rx.recDest.stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      this.dispatchEvent(new CustomEvent('recording', { detail: blob }));
    };
    rec.start(1000);
    this.recorder = rec;
    this.dispatchEvent(new Event('state'));
    return true;
  }

  stopRecording() {
    if (!this.recorder) return;
    this.recorder.stop();
    this.recorder = null;
    this.dispatchEvent(new Event('state'));
  }
}
