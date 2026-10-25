// Yaesu FT-991A CAT protocol, following the FT-991A CAT Operation Reference Manual (Yaesu, rev. 1808-D).
// The FTX-1 driver's link, queue, polling and state are reused; the radio state keeps the same shape, so the app reads
// both radios the same way. The FT-991A has one receiver: index 0 is VFO-A (the operating side), index 1 is VFO-B
// (frequency and mode only, as the radio shows it). Commands whose format differs from the FTX-1 are overridden here.

import { FTX1, bandType, isFM } from './ftx1.js';

const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// MS P1 (FT-991A: 0 COMP 1 ALC 2 PO 3 SWR 4 ID) <-> the FTX-1 codes the app uses (0 PO 1 COMP 2 ALC 3 VDD 4 ID 5 SWR)
const MS_IN = { 0: '1', 1: '2', 2: '0', 3: '5', 4: '4' };
const MS_OUT = Object.fromEntries(Object.entries(MS_IN).map(([a, b]) => [b, a]));
// SQ is 000-100 on the FT-991A; the app keeps 0-255 as on the FTX-1
const sqIn = (v) => Math.round(v * 2.55), sqOut = (v) => Math.round(v / 2.55);

export class FT991A extends FTX1 {
  constructor() {
    super();
    Object.assign(this.s, { dual: false, nbOn: false, nbLv: 5, nrOn: false, nrLv: 8, voxDelay: 500, bkDelay: 200, ri: { hiswr: false, tuning: false, busy: false } });
  }

  // RTS on (the radio answers only then while menu 033 CAT RTS is ENABLE) and DTR off: with DTR on (as a port is often
  // opened on macOS) its replies come garbled or not at all. Measured on a radio: 1 or 2 stop bits both work.
  rates = [38400, 4800, 9600, 19200]; // menu 031 CAT RATE goes up to 38400
  // (also NR0 / IS0 / BC0 / NA0, refused in some modes, see _levelPoll; logged, not counted as errors)
  modeDependent = /^(MG|RA|NR0|IS0|BC0|NA0)/;
  async _afterOpen() { await this.link.setSignals({ requestToSend: true, dataTerminalReady: false }).catch(() => {}); }

  // ---- polling ----
  readAll() {
    ['ID;', 'FA;', 'FB;', 'IF;', 'OI;', 'FT;', 'TX;',
      'AG0;', 'RG0;', 'SQ0;', 'PC;', 'MG;', 'KS;', 'KP;', 'BI;', 'VX;', 'VG;', 'ML0;', 'ML1;',
      'NB0;', 'NL0;', 'RL0;', 'NA0;', 'BC0;', 'BP00;', 'BP01;', 'CO00;', 'CO01;', 'CO02;', 'CO03;',
      'RA0;', 'PA0;', 'GT0;', 'SH0;', 'LK;', 'AC;', 'CS;', 'FS;', 'MS;', 'BY;', 'RI0;',
      'MX;', 'TS;', 'KR;', 'PR0;', 'PR1;', 'PL;', 'VD;', 'SD;', 'OS0;', 'CT0;', 'CN00;', 'CN01;', 'AI;'].forEach((c) => this.send(c, { read: true }));
  }
  _slowPoll() {
    const p = { poll: true };
    ['TX;', 'FA;', 'FB;', 'IF;', 'OI;', 'BY;', 'RI0;'].forEach((c) => this.send(c, p));
  }
  _levelPoll() {
    const p = { poll: true };
    if (bandType(this.s.freq[0]) === 0) this.send('RA0;', p);
    // reads the radio answers '?' to in some modes (tried on the radio in each mode): NR0 in FM / FM-N / DATA-FM / C4FM,
    // IS0 there and in AM / AM-N, NA0 in C4FM; read where they work only, so not at connect either
    const m = this.s.mode[0], fm = isFM(m);
    ['AG0;', 'SQ0;', 'RG0;', 'PC;', 'FT;', 'LK;', 'NB0;', 'NL0;', ...(fm ? [] : ['NR0;']), ...(fm || m === '5' || m === 'D' ? [] : ['IS0;']),
      'RL0;', ...(m === 'E' ? [] : ['NA0;']), 'PA0;', 'GT0;', 'SH0;',
      'FS;', 'MS;', 'ML0;', 'ML1;', 'CS;', 'PL;', 'VD;', 'SD;'].forEach((c) => this.send(c, p));
  }

  // ---- parser ----
  _parse(c, p) {
    const s = this.s;
    const num = (a, b) => parseInt(p.slice(a, b), 10);
    const ok = (key) => !this._held(key);
    switch (c) {
      // IF (VFO-A) / OI (VFO-B): P1 memory ch (3) + freq (9) + clar offset (5) + RX clar + TX clar + mode + P7 + ...
      case 'IF': case 'OI': {
        const vfo = c === 'IF' ? 0 : 1;
        const f = p.slice(3, 12);
        if (/^\d{9}$/.test(f) && ok(vfo ? 'FB' : 'FA')) s.freq[vfo] = +f;
        if (p.length < 21) break;
        if (this.MODE_OK(p[19]) && ok('MD' + vfo)) s.mode[vfo] = p[19];
        if (/^[0-6]$/.test(p[20])) s.vm[vfo] = { t: +p[20], ch: p.slice(0, 3) };
        if (vfo === 0) {
          if (ok('CFf0')) s.clarOfs[0] = (p[12] === '-' ? -1 : 1) * (num(13, 17) || 0);
          if (ok('CFs0')) { s.clarRx[0] = p[17] === '1'; s.clarTx[0] = p[18] === '1'; }
        }
        break;
      }
      case 'MD': if (p[0] === '0' && this.MODE_OK(p[1]) && ok('MD0')) s.mode[0] = p[1]; break;
      case 'SQ': if (ok('SQ0')) s.sql[0] = sqIn(num(1, 4) || 0); break;
      case 'PC': if (ok('PC')) s.power = num(0, 3) || 0; break;
      case 'FT': if (ok('FT')) s.ft = p[0] === '1' ? 1 : 0; break;
      case 'MS': if (ok('MS') && MS_IN[p[0]]) s.ms = [MS_IN[p[0]], MS_IN[p[0]]]; break;
      // NB / NR: on-off and level are separate commands; the app's level is 0 when off
      case 'NB': if (ok('NB0')) { s.nbOn = p[1] === '1'; s.nb[0] = s.nbOn ? s.nbLv : 0; } break;
      case 'NL': if (ok('NB0')) { s.nbLv = num(1, 4) || 0; if (s.nbOn) s.nb[0] = s.nbLv; } break;
      case 'NR': if (ok('NR0')) { s.nrOn = p[1] === '1'; s.nr[0] = s.nrOn ? s.nrLv : 0; } break;
      case 'RL': if (ok('NR0')) { s.nrLv = num(1, 3) || 1; if (s.nrOn) s.nr[0] = s.nrLv; } break;
      case 'PA': if (ok('PA')) { const v = +p[1] || 0; s.preamp = [v, v, v]; } break;
      case 'IS':
        if (ok('IS0')) {
          const hz = (p[1] === '-' ? -1 : 1) * (num(2, 6) || 0);
          s.shiftOn[0] = hz !== 0;
          if (hz) s.shift[0] = hz;
        }
        break;
      case 'SH': if (ok('SH0')) s.width[0] = num(1, 3) || 0; break;
      case 'FS': if (ok('FN')) s.fn = p[0] === '1' ? 2 : 0; break;
      case 'BY': s.ri = { ...s.ri, busy: p[0] === '1' }; break;
      case 'RI': if (p[0] === '0') s.ri = { ...s.ri, hiswr: p[1] === '1' }; break;
      case 'SC': if (ok('SC')) s.scan = p[0] !== '0'; break;
      case 'VD': if (ok('VD')) s.voxDelay = num(0, 4) || 0; break;
      case 'SD': if (ok('SD')) s.bkDelay = num(0, 4) || 0; break;
      case 'EX': if (p.length > 3 && ok('EX' + p.slice(0, 3))) s.ex[p.slice(0, 3)] = p.slice(3); break;
      // the FTX-1 meanings of these do not apply
      case 'VS': case 'FR': case 'SF': case 'FN': case 'SS': case 'CF': case 'DA': case 'AO': break;
      default: super._parse(c, p);
    }
  }
  MODE_OK(m) { return /^[1-9A-E]$/.test(m || ''); }

  // ---- setters ----
  setMode(vfo, code) {
    // MD sets the operating VFO (A) only; VFO-B's mode changes by swapping A/B on the radio
    if (vfo) return false;
    this._set('MD0', `MD0${code};`, () => { this.s.mode[0] = code; });
    setTimeout(() => this.send('SH0;', { read: true }), 300);
    return true;
  }
  setAF(vfo, v) { if (!vfo) super.setAF(0, v); }
  setRF(vfo, v) { if (!vfo) super.setRF(0, v); }
  setSQL(vfo, v) {
    if (vfo) return;
    v = clamp(Math.round(v), 0, 255);
    if (v === this.s.sql[0]) return;
    this._set('SQ0', `SQ0${pad(sqOut(v), 3)};`, () => { this.s.sql[0] = v; });
  }
  // PC 005-100 W on HF / 50 MHz, 005-050 W on 144 / 430 MHz
  powerRange() { return { min: 5, max: bandType(this.s.freq[this.s.ft]) ? 50 : 100, step: 1 }; }
  setPower(w) {
    const { min, max } = this.powerRange();
    w = clamp(Math.round(w), min, max);
    if (w === this.s.power) return;
    this._set('PC', `PC${pad(w, 3)};`, () => { this.s.power = w; });
  }
  nrMax = 15;
  setNB(vfo, v) {
    if (vfo) return;
    const s = this.s;
    v = clamp(Math.round(v), 0, 10);
    if (v === s.nb[0]) return;
    this._hold('NB0');
    if (v) { s.nbLv = v; this.send(`NL0${pad(v, 3)};`, { key: 'NL0' }); }
    if (!!v !== s.nbOn) this.send(`NB0${v ? 1 : 0};`, { key: 'NB0' });
    s.nbOn = !!v; s.nb[0] = v;
    this._changed();
  }
  setNR(vfo, v) {
    if (vfo) return;
    const s = this.s;
    v = clamp(Math.round(v), 0, 15);
    if (v === s.nr[0]) return;
    this._hold('NR0');
    if (v) { s.nrLv = v; this.send(`RL0${pad(v, 2)};`, { key: 'RL0' }); }
    if (!!v !== s.nrOn) this.send(`NR0${v ? 1 : 0};`, { key: 'NR0' });
    s.nrOn = !!v; s.nr[0] = v;
    this._changed();
  }
  setNarrow(vfo, on) { if (vfo) return; super.setNarrow(0, on); setTimeout(() => this.send('SH0;', { read: true }), 300); }
  setPreamp(v) { v = clamp(v, 0, 2); this._set('PA', `PA0${v};`, () => { this.s.preamp = [v, v, v]; }); }
  // IS P1 0 +/- 0000-1200 (20 Hz steps); "off" is sent as 0 Hz
  setShift(vfo, on, hz) {
    if (vfo) return;
    hz = clamp(Math.round(hz / 20) * 20, -1200, 1200);
    const out = on ? hz : 0;
    this._set('IS0', `IS0${out < 0 ? '-' : '+'}${pad(Math.abs(out), 4)};`, () => {
      this.s.shiftOn[0] = on && hz !== 0; if (hz) this.s.shift[0] = hz;
    });
  }
  setWidth(vfo, code, lo = 0, hi = 21) {
    if (vfo) return;
    code = clamp(code, lo, hi);
    if (code === this.s.width[0]) return;
    this._set('SH0', `SH0${pad(code, 2)};`, () => { this.s.width[0] = code; });
  }
  // FAST key (FS): the app's "FAST" (s.fn 2); the FT-991A has no FINE
  setFine(n) { this._set('FN', `FS${n === 2 ? 1 : 0};`, () => { this.s.fn = n === 2 ? 2 : 0; }); }
  setMeterSel(main) { const m = MS_OUT[main]; if (m == null) return; this._set('MS', `MS${m};`, () => { this.s.ms = [main, main]; }); }
  zeroIn() { this.send('ZI;'); }
  setVoxDelay(ms) { ms = clamp(Math.round(ms / 10) * 10, 30, 3000); if (ms === this.s.voxDelay) return; this._set('VD', `VD${pad(ms, 4)};`, () => { this.s.voxDelay = ms; }); }
  setBkDelay(ms) { ms = clamp(Math.round(ms / 10) * 10, 30, 3000); if (ms === this.s.bkDelay) return; this._set('SD', `SD${pad(ms, 4)};`, () => { this.s.bkDelay = ms; }); }
  setRptShift(vfo, n) { if (!vfo) super.setRptShift(0, clamp(n, 0, 2)); }
  setSqlType(vfo, n) { if (!vfo) super.setSqlType(0, clamp(n, 0, 4)); }
  // KY P1 6-A: message keyer 1-5 (1-5 are the keyer memories)
  playMessage(n) { if (n >= 1 && n <= 5) this.send(`KY${'6789A'[n - 1]};`); }
  // CAT RATE (EX 031: 0 4800 1 9600 2 19200 3 38400); the port in use changes too, so reopen it at the new rate
  async setRadioBaud(rate) {
    const code = [4800, 9600, 19200, 38400].indexOf(rate);
    if (code < 0 || !this.connected) throw new Error('未接続または未対応の速度です');
    const port = this.port;
    this.queue.length = 0;
    await this.link.write(`EX031${code};`);
    await sleep(300);
    this._stopPolling();
    await this.link.write('AI0;').catch(() => {});
    await this.link.close();
    return this.connect(port, rate);
  }
  memTune() { return false; }
  selectVFO() {}
  setDual() {}
  // FT P1 2: VFO-A transmits, 3: VFO-B transmits (the answer is 0 / 1)
  setTxVFO(v) { this._set('FT', `FT${v ? 3 : 2};`, () => { this.s.ft = v ? 1 : 0; }); }
  tune() { this._set('AC', 'AC002;', () => { this.s.tuner = true; }); }
  // RX / TX clarifier (RT / XT); the offset moves by RU / RD steps from the value the radio reported (IF P3)
  setClar(vfo, rx, tx) {
    if (vfo) return;
    const s = this.s;
    this._hold('CFs0');
    if (rx !== s.clarRx[0]) this.send(`RT${rx ? 1 : 0};`);
    if (tx !== s.clarTx[0]) this.send(`XT${tx ? 1 : 0};`);
    s.clarRx[0] = rx; s.clarTx[0] = tx;
    this._changed();
  }
  setClarOffset(vfo, hz) {
    if (vfo) return;
    const s = this.s;
    hz = clamp(Math.round(hz), -9990, 9990);
    const d = hz - s.clarOfs[0];
    if (!d) return;
    this._hold('CFf0', 1200);
    this.send(hz === 0 ? 'RC;' : `R${d > 0 ? 'U' : 'D'}${pad(Math.abs(d), 4)};`);
    s.clarOfs[0] = hz;
    this._changed();
    clearTimeout(this.clarRead);
    this.clarRead = setTimeout(() => this.send('IF;', { read: true }), 1300);
  }
  setScan(on) { this._set('SC', `SC${on ? 1 : 0};`, () => { this.s.scan = on; }); }
  quickSplit() { this.send('QS;'); setTimeout(() => ['FB;', 'FT;', 'OI;'].forEach((c) => this.send(c, { read: true })), 300); }
  bandSelect(vfo, code) { this.send(`BS${pad(code, 2)};`); this._refreshVfo(0); }
  bandStep(vfo, up) { this.send(`B${up ? 'U' : 'D'}0;`); this._refreshVfo(0); }
  _refreshVfo() { setTimeout(() => ['FA;', 'IF;'].forEach((c) => this.send(c, { read: true })), 250); }
  swap() {
    this.send('SV;');
    const s = this.s;
    [s.freq[0], s.freq[1]] = [s.freq[1], s.freq[0]];
    [s.mode[0], s.mode[1]] = [s.mode[1], s.mode[0]];
    ['FA', 'FB', 'MD0', 'MD1'].forEach((k) => this._hold(k));
    this._changed();
    setTimeout(() => ['FA;', 'FB;', 'IF;', 'OI;'].forEach((c) => this.send(c, { read: true })), 300);
  }
  copyAtoB() { this.send('AB;'); setTimeout(() => ['FB;', 'OI;'].forEach((c) => this.send(c, { read: true })), 200); }
  copyBtoA() { this.send('BA;'); setTimeout(() => ['FA;', 'IF;'].forEach((c) => this.send(c, { read: true })), 200); }
  ptt(on) { super.ptt(on, 1); }
}

