// FT-991A bar meter, as the screen pictures of the operation manual (p.22, 43): large italic "S" and "PO" at the left,
// the S figures above the bar (1-9 white, +20 +40 +60dB blue), the selected TX meter's figures below it, and a bar of
// thin segments, grey to white up to S9 and red above. Positions are fractions of the meter's width measured on the
// picture; a scale may give each tick its place ([label, raw, minor, x]), otherwise ticks spread evenly by raw.
// Same interface as FtxMeter: configure({ top, bottom, reading, dimmed }), set(raw 0..255), setVol (unused here).

const FONT = '"Saira", "DIN Alternate", "Arial Narrow", sans-serif';
const BAR0 = 0.152, BAR1 = 0.857; // bar ends (fractions of the meter's width, measured on the product photo)
const SEGS = 72;
const BLUE = '#5b62ff', RED = '#e00000';
const DIGIT = '"Arial Black", Arial, sans-serif';
const FIG = 'Arial, "Helvetica Neue", sans-serif';

// raw -> x along the bar, piecewise between the ticks that carry a place
function xOf(scale, raw) {
  const pts = [[0, BAR0], ...scale.ticks.filter((t) => t[3] != null).map((t) => [t[1], t[3]])].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return BAR0 + (raw / 255) * (BAR1 - BAR0);
  for (let i = 1; i < pts.length; i++) {
    const [r1, x1] = pts[i], [r0, x0] = pts[i - 1];
    if (raw <= r1) return x0 + ((raw - r0) / (r1 - r0 || 1)) * (x1 - x0);
  }
  const [r1, x1] = pts[pts.length - 1];
  return Math.min(BAR1, x1 + ((raw - r1) / 255) * (BAR1 - BAR0));
}

export class Meter991 {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.top = null;
    this.bottom = null;
    this.reading = 'top';
    this.dimmed = false;
    this.target = 0;
    this.pos = 0;
    this.peak = 0;
    this.peakT = 0;
    const loop = () => { this._frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  configure({ top, bottom, reading = 'top', dimmed = false }) {
    this.top = top; this.bottom = bottom; this.reading = reading; this.dimmed = dimmed;
  }
  set(raw) { this.target = Math.min(255, Math.max(0, raw || 0)); }
  setVol() {}

  _frame() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1;
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    // quick rise, slower fall; peak hold ~1 s (menu 009 BAR MTR PEAK HOLD)
    this.pos += (this.target - this.pos) * (this.target > this.pos ? 0.6 : 0.18);
    const now = performance.now();
    if (this.pos >= this.peak || now - this.peakT > 1000) { this.peak = this.pos; this.peakT = now; }
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    if (!this.top) return;
    // rows, as fractions of the height (photo): figures, scale line, bar, scale line, figures
    const yTopFig = 0.215, yTopLine = 0.40, yBar0 = 0.43, yBar1 = 0.565, yBotLine = 0.60, yBotFig = 0.81;
    const lw = Math.max(1, H * 0.012);
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    // a scale: its line, major ticks at the figures and minor ticks between them, then the figures
    const scale = (sc, lineY, dir, figY, hot) => {
      const ticks = sc.ticks.filter((t) => !t[2]);
      const xs = ticks.map((t) => xOf(sc, t[1]));
      const xHot = hot != null ? xOf(sc, hot) : 2;
      const x0 = BAR0, x1 = Math.max(BAR1, xs[xs.length - 1] || BAR1);
      // line (white, blue beyond S9)
      c.fillStyle = '#fff';
      c.fillRect(x0 * W, lineY * H - lw / 2, (Math.min(xHot, x1) - x0) * W, lw);
      if (xHot < x1) { c.fillStyle = BLUE; c.fillRect(xHot * W, lineY * H - lw / 2, (x1 - xHot) * W, lw); }
      const tick = (x, len) => {
        c.fillStyle = x > xHot + 1e-4 ? BLUE : '#fff';
        c.fillRect(x * W - lw / 2, dir < 0 ? lineY * H - len * H : lineY * H, lw, len * H);
      };
      xs.forEach((x, i) => { tick(x, 0.07); if (i) tick((x + xs[i - 1]) / 2, 0.04); });
      // figures
      c.font = `italic 700 ${Math.round(H * 0.215)}px ${FIG}`;
      let last = 0;
      ticks.forEach((t, i) => {
        if (!t[0]) return;
        c.fillStyle = xs[i] > xHot + 1e-4 ? BLUE : '#fff';
        c.fillText(t[0], xs[i] * W, figY * H);
        last = xs[i] * W + c.measureText(t[0]).width / 2;
      });
      if (sc.unit) {
        c.textAlign = 'left';
        c.fillStyle = xHot < 1 ? BLUE : '#fff';
        c.fillText(sc.unit, last, figY * H); // ("+60dB", "150W": written close)
        c.textAlign = 'center';
      }
    };
    scale(this.top, yTopLine, -1, yTopFig, this.top.hot);
    if (this.bottom) scale(this.bottom, yBotLine, 1, yBotFig);
    // scale names: heavy italic "S" / "PO"
    c.fillStyle = '#fff';
    // (a longer name such as SWR / COMP is set smaller so it ends before the scale)
    const name = (t, x, y) => {
      c.font = `italic 900 ${Math.round(H * 0.29)}px ${DIGIT}`;
      const w = c.measureText(t).width, room = W * 0.115;
      if (w > room) c.font = `italic 900 ${Math.round(H * 0.29 * room / w)}px ${DIGIT}`;
      c.fillText(t, x, y);
    };
    name(this.top.name, W * 0.111, H * 0.36);
    if (this.bottom) name(this.bottom.name, W * 0.082, H * 0.69);
    // the bar: thin segments, grey to white up to S9, red above
    const sc = this.reading === 'bottom' && this.bottom ? this.bottom : this.top;
    const xLit = xOf(sc, this.pos), xPk = xOf(sc, this.peak);
    const xHot = this.reading === 'top' && sc.hot != null ? xOf(sc, sc.hot) : 2;
    const segW = (BAR1 - BAR0) / SEGS;
    for (let i = 0; i < SEGS; i++) {
      const x = BAR0 + i * segW, mid = x + segW / 2;
      const lit = mid <= xLit, pk = this.peak > 3 && Math.abs(mid - xPk) < segW / 2;
      if (!lit && !pk) continue;
      const f = Math.min(1, (mid - BAR0) / ((xHot < 2 ? xHot : BAR1) - BAR0));
      const g = Math.round(120 + 135 * f);
      c.fillStyle = this.dimmed ? '#555' : mid > xHot ? RED : `rgb(${g},${g},${g})`;
      c.fillRect(x * W, yBar0 * H, segW * W * 0.55, (yBar1 - yBar0) * H);
    }
  }
}
