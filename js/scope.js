// AF-FFT scope + waterfall drawn from the RX audio analyser (like the FTX-1's AF-FFT display)

function waterfallLut() {
  const stops = [[0, 0, 8, 30], [0.25, 0, 40, 140], [0.45, 0, 160, 230], [0.62, 40, 230, 120], [0.78, 250, 230, 40], [0.9, 255, 120, 20], [1, 255, 30, 30]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < x) k++;
    const [x0, ...c0] = stops[k - 1], [x1, ...c1] = stops[k];
    const f = (x - x0) / (x1 - x0 || 1);
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return lut;
}

export class AfScope {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyser = null;
    this.sampleRate = 48000;
    this.span = 3000;
    this.lut = waterfallLut();
    this.wf = document.createElement('canvas');
    this.wfCtx = this.wf.getContext('2d');
    this.peaks = null;
    this.marker = null; // {lo, hi} passband shading in Hz
    this.label = '';
    new ResizeObserver(() => this._resize()).observe(canvas);
    this._resize();
    const loop = () => { this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setSource(analyser, sampleRate) {
    this.analyser = analyser;
    this.sampleRate = sampleRate || 48000;
    this.bins = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    this.peaks = null;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.round(this.cv.clientWidth * dpr));
    const h = Math.max(10, Math.round(this.cv.clientHeight * dpr));
    if (w === this.cv.width && h === this.cv.height) return;
    this.cv.width = w;
    this.cv.height = h;
    this.dpr = dpr;
    this.wf.width = w;
    this.wf.height = Math.round(h * 0.55);
    this.wfCtx.fillStyle = '#000';
    this.wfCtx.fillRect(0, 0, this.wf.width, this.wf.height);
    this.row = this.wfCtx.createImageData(w, 1);
  }

  _draw() {
    const { ctx, cv } = this;
    const W = cv.width, H = cv.height, dpr = this.dpr || 1;
    const specH = H - this.wf.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, specH);

    // grid
    ctx.strokeStyle = 'rgba(160,166,174,0.22)';
    ctx.lineWidth = 1;
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(200,205,212,0.75)';
    for (let f = 500; f < this.span; f += 500) {
      const x = Math.round((f / this.span) * W) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, specH); ctx.stroke();
      ctx.fillText(f % 1000 ? '' : `${f / 1000}k`, x + 2 * dpr, specH - 3 * dpr);
    }
    for (let i = 1; i < 4; i++) {
      const y = Math.round((specH * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    if (this.marker) {
      const x0 = (this.marker.lo / this.span) * W, x1 = (this.marker.hi / this.span) * W;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x0, 0, x1 - x0, specH);
    }


    if (!this.analyser) {
      ctx.fillStyle = 'rgba(200,205,212,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText('USB AUDIO RX 停止中 — クリックで開始', W / 2, specH / 2);
      ctx.textAlign = 'left';
      ctx.drawImage(this.wf, 0, specH);
      return;
    }

    const an = this.analyser;
    an.getFloatFrequencyData(this.bins);
    const binHz = this.sampleRate / an.fftSize;
    const minDb = an.minDecibels, range = an.maxDecibels - an.minDecibels;
    if (!this.peaks || this.peaks.length !== W) this.peaks = new Float32Array(W);

    // spectrum line + fill
    ctx.beginPath();
    ctx.moveTo(0, specH);
    const row = this.row.data;
    for (let x = 0; x < W; x++) {
      const f0 = (x / W) * this.span, f1 = ((x + 1) / W) * this.span;
      let b0 = Math.floor(f0 / binHz), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
      let m = -200;
      for (let b = b0; b < b1 && b < this.bins.length; b++) if (this.bins[b] > m) m = this.bins[b];
      const v = Math.min(1, Math.max(0, (m - minDb) / range));
      this.peaks[x] = Math.max(v, this.peaks[x] - 0.004);
      ctx.lineTo(x, specH - v * specH * 0.92);
      const li = Math.round(v * 255) * 3;
      row[x * 4] = this.lut[li];
      row[x * 4 + 1] = this.lut[li + 1];
      row[x * 4 + 2] = this.lut[li + 2];
      row[x * 4 + 3] = 255;
    }
    ctx.lineTo(W, specH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, specH);
    g.addColorStop(0, 'rgba(120,130,255,0.85)');
    g.addColorStop(1, 'rgba(40,50,190,0.35)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#ff3a3a';
    ctx.lineWidth = 1.2 * dpr;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,180,60,0.6)';
    for (let x = 0; x < W; x += 2) ctx.fillRect(x, specH - this.peaks[x] * specH * 0.92, 2, 1);

    // waterfall: scroll down one row
    const wc = this.wfCtx;
    wc.drawImage(this.wf, 0, 0, W, this.wf.height - 1, 0, 1, W, this.wf.height - 1);
    wc.putImageData(this.row, 0, 0);
    ctx.drawImage(this.wf, 0, specH);
  }
}
