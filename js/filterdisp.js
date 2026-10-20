// FTX-1 style "Filter Function Display": DSP passband trapezoid with the received
// audio spectrum drawn inside, plus NOTCH / CONTOUR markers.

export class FilterDisplay {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyser = null;
    this.sampleRate = 48000;
    this.state = { lo: 300, hi: 2700, span: 3600, notch: null, contour: null };
    this.bins = null;
    this.smooth = null;
    const loop = () => { this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setSource(analyser, sampleRate) {
    this.analyser = analyser;
    this.sampleRate = sampleRate || 48000;
    this.bins = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
  }

  set(state) { this.state = { ...this.state, ...state }; }

  _draw() {
    const cv = this.cv;
    if (!cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = this.ctx;
    const { lo, hi, span, notch, contour } = this.state;
    c.clearRect(0, 0, W, H);

    const x = (hz) => (hz / span) * W;
    const base = H * 0.94, top = H * 0.12;
    const slope = Math.min(W * 0.06, (x(hi) - x(lo)) * 0.12);
    const xl = Math.max(0, x(lo)), xr = Math.min(W, x(hi));

    // baseline
    c.strokeStyle = '#9aa0a8';
    c.lineWidth = Math.max(1, H * 0.03);
    c.beginPath(); c.moveTo(0, base); c.lineTo(W, base); c.stroke();

    // passband trapezoid
    c.beginPath();
    c.moveTo(xl - slope, base);
    c.lineTo(xl + slope * 0.3, top);
    c.lineTo(xr - slope * 0.3, top);
    c.lineTo(xr + slope, base);
    c.closePath();
    c.strokeStyle = '#e6e9ed';
    c.lineWidth = Math.max(1, H * 0.035);
    c.stroke();

    // spectrum inside the passband
    if (this.analyser && this.bins) {
      this.analyser.getFloatFrequencyData(this.bins);
      const binHz = this.sampleRate / this.analyser.fftSize;
      const n = Math.max(8, Math.round((xr - xl) / (2 * dpr)));
      if (!this.smooth || this.smooth.length !== n) this.smooth = new Float32Array(n);
      c.save();
      c.beginPath();
      c.moveTo(xl - slope, base); c.lineTo(xl + slope * 0.3, top); c.lineTo(xr - slope * 0.3, top); c.lineTo(xr + slope, base);
      c.closePath();
      c.clip();
      c.fillStyle = '#9ca2aa';
      const bw = (xr - xl) / n;
      for (let i = 0; i < n; i++) {
        const f0 = lo + ((hi - lo) * i) / n, f1 = lo + ((hi - lo) * (i + 1)) / n;
        let m = -200;
        for (let b = Math.floor(f0 / binHz); b <= Math.ceil(f1 / binHz) && b < this.bins.length; b++) m = Math.max(m, this.bins[b]);
        const v = Math.min(1, Math.max(0, (m + 100) / 70));
        this.smooth[i] = Math.max(v, this.smooth[i] * 0.85);
        const h = this.smooth[i] * (base - top) * 0.95;
        c.fillRect(xl + i * bw, base - h, Math.max(1, bw * 0.7), h);
      }
      c.restore();
    }

    // NOTCH: a V cut into the top edge; CONTOUR: a bump
    if (notch != null && notch > lo && notch < hi) {
      const nx = x(notch);
      c.fillStyle = '#000';
      c.beginPath(); c.moveTo(nx - H * 0.18, top - 1); c.lineTo(nx, H * 0.7); c.lineTo(nx + H * 0.18, top - 1); c.closePath(); c.fill();
      c.strokeStyle = '#d7dbe0';
      c.beginPath(); c.moveTo(nx - H * 0.18, top); c.lineTo(nx, H * 0.7); c.lineTo(nx + H * 0.18, top); c.stroke();
    }
    if (contour != null && contour > lo && contour < hi) {
      const cx = x(contour);
      c.strokeStyle = '#ffb020';
      c.lineWidth = Math.max(1, H * 0.04);
      c.beginPath(); c.arc(cx, top + H * 0.02, H * 0.16, Math.PI, 0); c.stroke();
    }
  }
}
