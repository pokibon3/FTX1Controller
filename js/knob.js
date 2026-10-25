// Rotary controls: small knobs (drag/wheel/keys -> steps) and the main tuning dial (angular drag with flywheel)

// One mouse-wheel notch = one step, however slowly or quickly it is turned: the scroll amount (which macOS accelerates
// with speed) is ignored, only its direction counts. A notch can arrive as a burst of events (smooth scrolling): events
// following each other within BURST_MS are one notch; a long stream of them (trackpad) gives a step every STREAM_MS.
// state: an object kept per control.
const BURST_MS = 40, STREAM_MS = 120;
export function wheelNotch(e, state) {
  if (!e.deltaY) return 0;
  const now = performance.now();
  const newBurst = now - (state.last || 0) > BURST_MS;
  state.last = now;
  if (!newBurst && now - (state.step || 0) < STREAM_MS) return 0;
  state.step = now;
  return e.deltaY < 0 ? 1 : -1;
}

// Acceleration for a wheel notch (n = ±1 from wheelNotch): turned slowly, a notch stays one step; notches following each
// other quickly (a fast spin) count more, up to 8 steps, growing with the run of quick notches.
const ACCEL_MS = 160;
export function wheelAccel(n, state) {
  const now = performance.now();
  const quick = now - (state.accT || 0) < ACCEL_MS && Math.sign(n) === state.accDir;
  state.run = quick ? (state.run || 0) + 1 : 0;
  state.accT = now; state.accDir = Math.sign(n);
  return n * Math.min(8, 1 + Math.floor(state.run / 2));
}

export class Knob {
  // angular: turned by circling it (the angle around its centre, degPerStep per step) instead of by straight drags
  // accel: mouse-wheel acceleration (wheelAccel)
  constructor(el, { onTurn, onPress, pxPerStep = 5, angular = false, degPerStep = 15, accel = false } = {}) {
    this.el = el;
    this.accel = accel;
    this.angular = angular;
    this.degPerStep = degPerStep;
    this.cap = el.querySelector('.cap') || el;
    this.onTurn = onTurn;
    this.pxPerStep = pxPerStep;
    this.acc = 0;
    this.wheelState = {};
    this.free = 0;
    this.active = false;
    el.tabIndex = 0;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      this.active = true;
      this.moved = 0;
      this.last = { x: e.clientX, y: e.clientY };
      this.lastA = this._angleOf(e);
      el.classList.add('grab');
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      this.moved += Math.abs(e.clientX - this.last.x) + Math.abs(e.clientY - this.last.y);
      if (this.angular) {
        const a = this._angleOf(e);
        let d = a - this.lastA;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        this.lastA = a;
        this.last = { x: e.clientX, y: e.clientY };
        this.acc += d;
        const n = Math.trunc(this.acc / this.degPerStep);
        if (n) { this.acc -= n * this.degPerStep; this._turn(n); }
        return;
      }
      this.acc += (e.clientX - this.last.x) - (e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
      const n = Math.trunc(this.acc / this.pxPerStep);
      if (n) { this.acc -= n * this.pxPerStep; this._turn(n); }
    });
    const end = (e) => {
      if (this.active && e.type === 'pointerup' && this.moved < 4) onPress?.();
      this.active = false;
      this.acc = 0;
      el.classList.remove('grab');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const n = wheelNotch(e, this.wheelState);
      if (n) this._turn(this.accel ? wheelAccel(n, this.wheelState) : n);
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); this._turn(d); }
      if (e.key === 'Enter' && onPress) onPress();
    });
  }

  // angle of the pointer around the knob's centre, clockwise from 12 o'clock (deg)
  _angleOf(e) {
    const r = this.el.getBoundingClientRect();
    return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
  }

  _turn(n) {
    this.free += n * (this.angular ? this.degPerStep : 12);
    this.onTurn?.(n);
  }

  // bounded knob: show position of a 0..1 value across a 270° sweep
  setFraction(f) {
    f = Math.min(1, Math.max(0, f || 0));
    this.cap.style.transform = `rotate(${-135 + f * 270}deg)`;
  }

  // endless knob: rotate with the user's input
  showFree() { this.cap.style.transform = `rotate(${this.free}deg)`; }
}

export class Dial {
  constructor(el, { onStep, stepsPerRev = 250 } = {}) {
    this.el = el;
    this.disc = el.querySelector('.dial-disc');
    this.onStep = onStep;
    this.stepsPerRev = stepsPerRev;
    this.angle = 0;     // visual rotation (deg)
    this.accDeg = 0;    // not yet emitted rotation
    this.vel = 0;       // deg/ms for flywheel
    this.dragging = false;
    this.wheelAcc = 0;
    this.wheelState = {};

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.vel = 0;
      cancelAnimationFrame(this.raf);
      this.prevA = this._angleOf(e);
      this.prevT = performance.now();
      el.classList.add('grab');
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const a = this._angleOf(e);
      let d = a - this.prevA;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      const t = performance.now();
      const dt = Math.max(1, t - this.prevT);
      this.vel = this.vel * 0.6 + (d / dt) * 0.4;
      this.prevA = a;
      this.prevT = t;
      this._rotate(d);
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('grab');
      if (performance.now() - this.prevT > 60) this.vel = 0;
      if (Math.abs(this.vel) > 0.25) this._spin();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // main dial: accelerated (fast turning moves further), but every notch moves at least one step
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const notch = wheelNotch(e, this.wheelState);
      this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      let n = Math.trunc(this.wheelAcc / 20);
      if (!n && notch) n = -notch;
      if (n) {
        this.wheelAcc = n === -notch && Math.abs(this.wheelAcc) < 20 ? 0 : this.wheelAcc - n * 20;
        this._rotate((-n * 360) / this.stepsPerRev);
      }
    }, { passive: false });
  }

  _angleOf(e) {
    const r = this.el.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  }

  _rotate(deg) {
    this.angle += deg;
    this.disc.style.transform = `rotate(${this.angle}deg)`;
    this.accDeg += deg;
    const per = 360 / this.stepsPerRev;
    const n = Math.trunc(this.accDeg / per);
    if (n) {
      this.accDeg -= n * per;
      this.onStep?.(n);
    }
  }

  _spin() {
    let last = performance.now();
    const frame = (t) => {
      const dt = t - last;
      last = t;
      this._rotate(this.vel * dt);
      this.vel *= Math.pow(0.994, dt);
      if (Math.abs(this.vel) > 0.02 && !this.dragging) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() { this.vel = 0; cancelAnimationFrame(this.raf); }
}
