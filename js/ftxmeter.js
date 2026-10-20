// FTX-1 style on-screen meter: white italic scales on black, two shallow arcs,
// red S9+ section, thin needle pivoting from far below, VOL line underneath.
// The needle angle is linear in raw (0..255); each tick sits where the needle line crosses its arc,
// so both scales read correctly off the same needle like a real moving-coil meter.

const FONT = '"Saira", "DIN Alternate", "Arial Narrow", sans-serif';

export class FtxMeter {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.top = null;      // { name, ticks:[[label, raw, minor?]], hot?, unit? }
    this.bottom = null;
    this.reading = 'top'; // which scale the needle reads ('top' | 'bottom')
    this.target = 0;
    this.pos = 0;
    this.vel = 0;
    this.vol = 0;
    this.dimmed = false;
    this.face = document.createElement('canvas');
    this.key = '';
    new ResizeObserver(() => { this.key = ''; }).observe(canvas);
    document.fonts?.addEventListener?.('loadingdone', () => { this.key = ''; });
    const loop = () => { this._frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  configure({ top, bottom, reading = 'top', dimmed = false }) {
    this.top = top;
    this.bottom = bottom;
    this.reading = reading;
    this.dimmed = dimmed;
  }
  set(raw) { this.target = Math.min(255, Math.max(0, raw || 0)); }
  setVol(f) { this.vol = Math.min(1, Math.max(0, f || 0)); }

  _geom(W, H) {
    const R = W * 3.2;
    const arcs = {
      top: { cx: W * 0.6, cy: H * 0.43 + R, r: R },
      bottom: { cx: W * 0.6, cy: H * 0.68 + R, r: R },
    };
    const P = { x: W * 0.52, y: H * 1.75 };
    // needle sweep: S-arc crossing from x=0.085W (raw 0) to x=0.965W (raw 255)
    const yOn = (arc, x) => arc.cy - Math.sqrt(arc.r * arc.r - (x - arc.cx) ** 2);
    const ang = (x) => Math.atan2(x - P.x, P.y - yOn(arcs.top, x));
    return { W, H, R, arcs, P, a0: ang(W * 0.1), a1: ang(W * 0.9) };
  }

  _angle(g, raw) { return g.a0 + (raw / 255) * (g.a1 - g.a0); }

  // where the needle at angle a crosses the arc
  _hit(g, arc, a) {
    const dx = Math.sin(a), dy = -Math.cos(a);
    const fx = g.P.x - arc.cx, fy = g.P.y - arc.cy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - arc.r * arc.r;
    const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * c))) / 2; // pivot is inside the circle: take the forward crossing
    return { x: g.P.x + dx * t, y: g.P.y + dy * t };
  }

  _drawScale(c, g, sc, arc, isTop) {
    const { H } = g;
    const white = '#f4f6f8', red = sc.hotColor || '#ff3b30';
    const fs = H * (isTop ? 0.2 : 0.19);
    // arc line, split at the hot point
    const seg = (r0, r1, color) => {
      c.strokeStyle = color;
      c.lineWidth = Math.max(1, H * 0.022);
      c.beginPath();
      for (let r = r0; r <= r1; r += 2) {
        const p = this._hit(g, arc, this._angle(g, r));
        if (r === r0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
      }
      c.stroke();
    };
    const hot = sc.hot ?? 255;
    seg(0, hot, white);
    if (hot < 255) seg(hot + 2, 255, red);
    if (sc.band) {
      // ALC-style thick zone bars along the arc
      for (const [b0, b1] of sc.band) {
        c.strokeStyle = white;
        c.lineWidth = H * 0.06;
        c.beginPath();
        for (let r = b0; r <= b1; r += 2) {
          const p = this._hit(g, arc, this._angle(g, r));
          const q = { x: p.x, y: p.y - H * 0.04 };
          if (r === b0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y);
        }
        c.stroke();
      }
    }

    let lastLabel = null;
    for (const [label, raw, minor] of sc.ticks) {
      const a = this._angle(g, raw);
      const p = this._hit(g, arc, a);
      const isHot = raw > hot;
      const len = H * (minor ? 0.05 : 0.09);
      const ux = Math.sin(a), uy = -Math.cos(a);
      c.strokeStyle = isHot ? red : white;
      c.lineWidth = Math.max(1, H * 0.02);
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(p.x + ux * len, p.y + uy * len);
      c.stroke();
      if (!label) continue;
      c.fillStyle = isHot ? red : white;
      c.font = `italic 700 ${fs}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      const lx = p.x + ux * len * 1.3, ly = p.y + uy * len * 1.3 - H * 0.02;
      c.fillText(label, lx, ly);
      lastLabel = { x: lx + c.measureText(label).width / 2, y: ly };
    }

    // scale name at the far left (big italic "S", smaller "PO"/"ALC" ...)
    c.fillStyle = white;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const start = this._hit(g, arc, this._angle(g, 0));
    c.font = `italic 800 ${isTop ? H * 0.3 : H * 0.18}px ${FONT}`;
    c.fillText(sc.name, H * 0.04, isTop ? start.y - H * 0.02 : start.y + H * 0.05);

    // unit after the last tick ("W") or "dB" over "+60"
    if (sc.unit) {
      const last = this._hit(g, arc, this._angle(g, 255));
      c.fillStyle = sc.unitHot ? red : white;
      c.font = `italic 700 ${fs * (sc.unitAbove ? 0.85 : 1.05)}px ${FONT}`;
      c.textAlign = sc.unitAbove ? 'center' : 'left';
      if (sc.unitAbove) c.fillText(sc.unit, last.x - H * 0.05, last.y - H * 0.34);
      // right of the last tick label on its baseline, so it never overlaps the "15" / "10" figures
      else if (lastLabel) c.fillText(sc.unit, Math.max(last.x + H * 0.03, lastLabel.x + fs * 0.2), lastLabel.y);
      else c.fillText(sc.unit, last.x + H * 0.03, last.y + H * 0.02);
    }
  }

  _drawFace() {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(10, Math.round(this.cv.clientWidth * dpr));
    const H = Math.max(10, Math.round(this.cv.clientHeight * dpr));
    const key = `${W}x${H}|${this.dimmed}|${JSON.stringify([this.top, this.bottom])}`;
    if (key === this.key) return;
    this.key = key;
    this.cv.width = this.face.width = W;
    this.cv.height = this.face.height = H;
    const g = (this.geom = this._geom(W, H));
    const c = this.face.getContext('2d');
    c.clearRect(0, 0, W, H);
    c.globalAlpha = this.dimmed ? 0.4 : 1;
    if (this.top) this._drawScale(c, g, this.top, g.arcs.top, true);
    if (this.bottom) this._drawScale(c, g, this.bottom, g.arcs.bottom, false);
    // VOL label
    c.fillStyle = '#f4f6f8';
    c.font = `italic 700 ${H * 0.15}px ${FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('VOL', H * 0.04, H * 0.93);
    c.globalAlpha = 1;
  }

  _frame() {
    if (!this.top || !this.cv.clientWidth) return;
    this._drawFace();
    // moving-coil ballistics: quick rise, slight overshoot, slower fall
    const k = this.target > this.pos ? 0.16 : 0.07;
    this.vel += (this.target - this.pos) * k;
    this.vel *= 0.7;
    this.pos = Math.min(262, Math.max(-4, this.pos + this.vel));

    const { ctx: c, cv } = this;
    const g = this.geom;
    const { W, H } = g;
    c.clearRect(0, 0, W, H);
    c.drawImage(this.face, 0, 0);

    // VOL line
    const vx0 = H * 0.5, vx1 = W * 0.97, vy = H * 0.93;
    c.lineWidth = Math.max(1, H * 0.035);
    c.strokeStyle = '#3b3f45';
    c.beginPath(); c.moveTo(vx0, vy); c.lineTo(vx1, vy); c.stroke();
    c.strokeStyle = '#e8241c';
    c.beginPath(); c.moveTo(vx0, vy); c.lineTo(vx0 + (vx1 - vx0) * this.vol, vy); c.stroke();

    // needle: visible segment between just above the top arc and just below the bottom arc
    const a = this._angle(g, this.pos);
    const p0 = this._hit(g, { ...g.arcs.bottom, r: g.arcs.bottom.r - H * 0.1 }, a);
    const p1 = this._hit(g, { ...g.arcs.top, r: g.arcs.top.r + H * 0.12 }, a);
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255, 40, 30, 0.3)';
    c.lineWidth = Math.max(2, H * 0.06);
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    c.strokeStyle = this.dimmed ? '#7a7f88' : '#ff2a1f';
    c.lineWidth = Math.max(1.5, H * 0.028);
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
  }
}
