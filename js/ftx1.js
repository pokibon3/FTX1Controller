// Yaesu FTX-1 CAT protocol + radio state.
// Command formats follow the FTX-1 series CAT Operation Reference Manual (Yaesu, rev. 2508-C).
// VFO index: 0 = MAIN (VFO-A), 1 = SUB (VFO-B).

import { SerialLink } from './serial.js';

const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const MODES = [
  { code: '1', name: 'LSB' }, { code: '2', name: 'USB' },
  { code: '3', name: 'CW-U' }, { code: '7', name: 'CW-L' },
  { code: '5', name: 'AM' }, { code: 'D', name: 'AM-N' },
  { code: '4', name: 'FM' }, { code: 'B', name: 'FM-N' },
  { code: 'C', name: 'DATA-U' }, { code: '8', name: 'DATA-L' },
  { code: 'A', name: 'DATA-FM' }, { code: 'F', name: 'D-FM-N' },
  { code: '9', name: 'RTTY-U' }, { code: '6', name: 'RTTY-L' },
  { code: 'E', name: 'PSK' }, { code: 'H', name: 'C4FM' },
];
export const MODE_NAME = Object.fromEntries(MODES.map((m) => [m.code, m.name]));
MODE_NAME.I = 'C4FM-VW';

export const isCW = (code) => code === '3' || code === '7';
export const isSSB = (code) => ['1', '2', '8', 'C', '6', '9', 'E'].includes(code);
export const isFM = (code) => ['4', 'B', 'A', 'F', 'H', 'I'].includes(code);

// BS band codes; lo/hi are used to detect the current band, def is the jump-in frequency for the local band stack
export const BANDS = [
  { code: 0, label: '1.8', name: '160m', lo: 1.8e6, hi: 2.0e6, def: 1.9e6, mode: '1' },
  { code: 1, label: '3.5', name: '80m', lo: 3.5e6, hi: 4.0e6, def: 3.535e6, mode: '1' },
  { code: 2, label: '5', name: '60m', lo: 5.0e6, hi: 5.5e6, def: 5.3305e6, mode: '2' },
  { code: 3, label: '7', name: '40m', lo: 7.0e6, hi: 7.3e6, def: 7.1e6, mode: '1' },
  { code: 4, label: '10', name: '30m', lo: 10.1e6, hi: 10.15e6, def: 10.12e6, mode: '3' },
  { code: 5, label: '14', name: '20m', lo: 14.0e6, hi: 14.35e6, def: 14.2e6, mode: '2' },
  { code: 6, label: '18', name: '17m', lo: 18.068e6, hi: 18.168e6, def: 18.12e6, mode: '2' },
  { code: 7, label: '21', name: '15m', lo: 21.0e6, hi: 21.45e6, def: 21.3e6, mode: '2' },
  { code: 8, label: '24', name: '12m', lo: 24.89e6, hi: 24.99e6, def: 24.94e6, mode: '2' },
  { code: 9, label: '28', name: '10m', lo: 28.0e6, hi: 29.7e6, def: 28.5e6, mode: '2' },
  { code: 10, label: '50', name: '6m', lo: 50.0e6, hi: 54.0e6, def: 50.25e6, mode: '2' },
  { code: 11, label: 'GEN', name: 'GEN', lo: 0.03e6, hi: 470e6, def: 0, mode: '' },
  { code: 12, label: 'AIR', name: 'AIR', lo: 108e6, hi: 137e6, def: 118.1e6, mode: '5' },
  { code: 13, label: '144', name: '2m', lo: 144e6, hi: 148e6, def: 145e6, mode: '4' },
  { code: 14, label: '430', name: '70cm', lo: 420e6, hi: 450e6, def: 433e6, mode: '4' },
];
export function bandOf(hz) {
  return BANDS.find((b) => b.code !== 11 && hz >= b.lo && hz <= b.hi) || BANDS[11];
}
// PA command P1: 0 = HF/50, 1 = 144, 2 = 430
export const bandType = (hz) => (hz >= 420e6 ? 2 : hz >= 144e6 ? 1 : 0);

export const AGC = ['OFF', 'FAST', 'MID', 'SLOW', 'AUTO'];
export const PREAMP_HF = ['IPO', 'AMP1', 'AMP2'];

// SH width code -> Hz (manual table 5; code 0 = default, which depends on the roofing filter)
const W_SSB = [0, 300, 400, 600, 850, 1100, 1200, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2450, 2500, 2600, 2700, 2800, 2900, 3000, 3200, 3500, 4000];
// CW / DATA-L/U / RTTY-L/U / PSK
const W_NAR = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1400, 1700, 2000, 2400, 3000, 3500, 4000];
const NAR_MODES = ['3', '7', '8', 'C', '6', '9', 'E'];
// AM / AM-N: 6000, FM-N / D-FM-N: 9000, FM / DATA-FM: 16000 (fixed)
const fixedWidth = (mode) => (mode === '5' || mode === 'D' ? 6000 : mode === 'B' || mode === 'F' ? 9000 : isFM(mode) ? 16000 : 0);
const widthTable = (mode) => (NAR_MODES.includes(mode) ? W_NAR : W_SSB);
export const widthMax = (mode) => (fixedWidth(mode) ? 0 : widthTable(mode).length - 1);
export function widthHz(mode, code) {
  if (fixedWidth(mode)) return fixedWidth(mode);
  if (code === 0) return isCW(mode) || ['6', '9', 'E'].includes(mode) ? 500 : 2400;
  return widthTable(mode)[code] || 2400;
}
export function widthText(mode, code) {
  if (fixedWidth(mode)) return `${fixedWidth(mode)}Hz`;
  if (code === 0) return 'DEF';
  const hz = widthTable(mode)[code];
  return hz ? `${hz}Hz` : String(code);
}

// S-meter raw (0-255) to text, Yaesu-style calibration
const S_CAL = [[0, -54], [12, -48], [27, -42], [40, -36], [55, -30], [65, -24], [80, -18], [95, -12], [112, -6], [130, 0], [150, 10], [172, 20], [190, 30], [220, 40], [240, 50], [255, 60]];
export function sDb(raw) {
  for (let i = 1; i < S_CAL.length; i++) {
    const [x1, y1] = S_CAL[i], [x0, y0] = S_CAL[i - 1];
    if (raw <= x1) return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 60;
}
export function sText(raw) {
  const db = sDb(raw);
  if (db <= 0) return `S${clamp(Math.round(9 + db / 6), 0, 9)}`;
  return `S9+${Math.round(db / 10) * 10}`;
}
export const S_TICKS = [['1', 12], ['3', 40], ['5', 65], ['7', 95], ['9', 130], ['+20', 172], ['+40', 220], ['+60', 255]];

const SWR_CAL = [[0, 1.0], [26, 1.2], [52, 1.5], [89, 2.0], [126, 3.0], [255, 9.9]];
export function swrValue(raw) {
  for (let i = 1; i < SWR_CAL.length; i++) {
    const [x1, y1] = SWR_CAL[i], [x0, y0] = SWR_CAL[i - 1];
    if (raw <= x1) return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 9.9;
}

function initialState() {
  return {
    id: '', ai: false,
    freq: [14200000, 7100000], mode: ['2', '1'],
    vs: 0, ft: 0, dual: true,
    tx: false,
    af: [80, 60], rf: [255, 255], sql: [0, 0],
    smeter: [0, 0], meters: { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
    pwrHead: 1, power: 10,
    mic: 50, ks: 20, kp: 30, bkin: false, vox: false, voxGain: 50, moni: 30, moniOn: false,
    nb: [0, 0], nr: [0, 0], nar: [false, false], bc: [false, false],
    notch: [false, false], notchHz: [1500, 1500],
    contour: [false, false], contourHz: [1000, 1000],
    apf: [false, false], apfOfs: [0, 0],
    att: false, preamp: [0, 0, 0], agc: [4, 4],
    shiftOn: [false, false], shift: [0, 0], width: [0, 0],
    lock: false, tuner: false, spot: false,
    // radio's own spectrum scope (SS P2 -> P3): 0 SPEED, 5 SPAN, 6 MODE
    scope: { 0: '2', 5: '6', 6: '0' },
    clarRx: [false, false], clarTx: [false, false], clarOfs: [0, 0],
    errors: 0, lastRx: 0,
  };
}

const POLL_PREFIX = /^(SM|RM)/;

export class FTX1 extends EventTarget {
  constructor() {
    super();
    this.link = new SerialLink();
    this.s = initialState();
    this.queue = [];
    this.sending = false;
    this.gap = 15; // ms between commands
    this.holds = new Map();
    this.timers = [];
    this.tick = 0;
    this.link.addEventListener('message', (e) => this._onMessage(e.detail));
    this.link.addEventListener('close', () => {
      if (this.probing) return;
      this._stopPolling();
      this.queue.length = 0;
      this.s.tx = false;
      this._emit('connection');
      this._changed();
    });
    this.link.addEventListener('error', (e) => this._emit('log', { dir: 'err', text: String(e.detail?.message || e.detail) }));
  }

  get connected() { return this.link.isOpen; }

  // baud: number or 'auto'. Resolves with the rate that got an ID reply; rejects with code NO_REPLY otherwise.
  async connect(port, baud) {
    const rates = baud === 'auto' ? [38400, 4800, 9600, 19200, 115200] : [+baud];
    this.probing = true;
    try {
      for (const b of rates) {
        await this.link.open(port, b);
        if (await this._probe()) {
          this.baud = b;
          this.probing = false;
          this._emit('connection');
          this.smSeen = this.rmSeen = false;
          this.smPolls = 0;
          this.readAll();
          this.send('AI1;');
          this._startPolling();
          return b;
        }
        await this.link.close();
      }
    } finally {
      this.probing = false;
    }
    const err = new Error('CAT応答なし');
    err.code = 'NO_REPLY';
    throw err;
  }

  async _probe() {
    for (let i = 0; i < 2; i++) {
      const got = await new Promise((resolve) => {
        const on = (e) => { if (/^ID\d+/.test(e.detail)) done(true); };
        const done = (v) => { clearTimeout(t); this.link.removeEventListener('message', on); resolve(v); };
        const t = setTimeout(() => done(false), 500);
        this.link.addEventListener('message', on);
        this.link.write('ID;').catch(() => done(false));
      });
      if (got) return true;
    }
    return false;
  }

  async disconnect() {
    if (!this.connected) return;
    this.queue.length = 0;
    if (this.s.tx) await this.link.write('TX0;').catch(() => {});
    await this.link.write('AI0;').catch(() => {});
    await sleep(50);
    await this.link.close();
  }

  // ---- low level ----
  send(cmd, { key, poll = false } = {}) {
    if (!this.connected) return;
    if (key) {
      const q = this.queue.find((x) => x.key === key);
      if (q) { q.cmd = cmd; return; }
    }
    if (poll && (this.queue.length > 16 || this.queue.some((x) => x.cmd === cmd))) return;
    this.queue.push({ cmd, key, poll });
    this._pump();
  }

  async _pump() {
    if (this.sending) return;
    this.sending = true;
    while (this.queue.length && this.connected) {
      const item = this.queue.shift();
      try {
        await this.link.write(item.cmd);
        this._emit('log', { dir: 'tx', text: item.cmd, poll: item.poll });
      } catch (e) {
        this._emit('log', { dir: 'err', text: e.message });
        break;
      }
      await sleep(this.gap);
    }
    this.sending = false;
  }

  raw(cmd) {
    cmd = cmd.trim().toUpperCase();
    if (!cmd) return;
    if (!cmd.endsWith(';')) cmd += ';';
    this.send(cmd);
  }

  _hold(key, ms = 700) { this.holds.set(key, performance.now() + ms); }
  _held(key) { const t = this.holds.get(key); return t && t > performance.now(); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _changed() { this.dispatchEvent(new Event('change')); }

  // optimistic local update + hold off incoming echoes for that key
  _set(key, cmd, apply) {
    apply();
    this._hold(key);
    this.send(cmd, { key });
    this._changed();
  }

  // ---- polling ----
  readAll() {
    ['ID;', 'FA;', 'FB;', 'MD0;', 'MD1;', 'VS;', 'FT;', 'FR;', 'TX;',
      'AG0;', 'AG1;', 'RG0;', 'RG1;', 'SQ0;', 'SQ1;', 'PC;', 'MG;', 'KS;', 'KP;', 'BI;', 'VX;', 'VG;', 'ML;',
      'NL0;', 'NL1;', 'RL0;', 'RL1;', 'NA0;', 'NA1;', 'BC0;', 'BC1;', 'BP00;', 'BP01;', 'CO00;', 'CO01;', 'CO02;', 'CO03;',
      'RA0;', 'PA0;', 'PA1;', 'PA2;', 'GT0;', 'GT1;', 'IS0;', 'IS1;', 'SH0;', 'SH1;', 'LK;', 'AC;', 'CS;', 'SS00;', 'SS05;', 'SS06;',
      'CF000;', 'CF001;', 'CF100;', 'CF101;', 'AI;'].forEach((c) => this.send(c));
  }

  _startPolling() {
    this._stopPolling();
    this.timers.push(setInterval(() => this._fastPoll(), 200));
    this.timers.push(setInterval(() => this._slowPoll(), 1500));
    this.timers.push(setInterval(() => this._levelPoll(), 6000));
  }
  _stopPolling() { this.timers.forEach(clearInterval); this.timers = []; }

  _fastPoll() {
    const p = { poll: true };
    if (this.s.tx) {
      const order = [5, 4, 6, 3, 7, 8];
      this.send('RM5;', p);
      this.send(`RM${order[1 + (this.tick++ % 5)]};`, p);
    } else {
      // prefer SM; if the radio never answers it, fall back to RM1/RM2 (main/sub S meter)
      this.smPolls = (this.smPolls || 0) + 1;
      const useRM = !this.smSeen && this.smPolls > 8 && (this.smPolls % 2 === 0 || this.rmSeen);
      this.send(useRM ? 'RM1;' : 'SM0;', p);
      if (this.s.dual) this.send(useRM ? 'RM2;' : 'SM1;', p);
    }
  }
  _slowPoll() {
    const p = { poll: true };
    ['TX;', 'FA;', 'FB;', 'MD0;', 'MD1;', 'VS;'].forEach((c) => this.send(c, p));
  }
  _levelPoll() {
    const p = { poll: true };
    ['AG0;', 'AG1;', 'SQ0;', 'SQ1;', 'RG0;', 'PC;', 'FT;', 'FR;', 'LK;', 'NL0;', 'RL0;', 'NA0;', 'RA0;',
      `PA${bandType(this.s.freq[this.s.vs])};`, 'GT0;', 'SH0;', 'SH1;'].forEach((c) => this.send(c, p));
  }

  // ---- parser ----
  _onMessage(m) {
    const s = this.s;
    s.lastRx = performance.now();
    this._emit('log', { dir: 'rx', text: m + ';', poll: POLL_PREFIX.test(m) });
    if (m === '?') { s.errors++; this._changed(); return; }
    const c = m.slice(0, 2), p = m.slice(2);
    const v = +p[0];
    const num = (a, b) => parseInt(p.slice(a, b), 10);
    const ok = (key) => !this._held(key);

    switch (c) {
      case 'FA': case 'FB': {
        const vfo = c === 'FA' ? 0 : 1;
        if (/^\d{9}$/.test(p) && ok(c)) s.freq[vfo] = +p;
        break;
      }
      // IF (MAIN) / OI (SUB): P1 memory ch (5) + freq (9) + clar (5) + RX clar + TX clar + mode + ...
      case 'IF': case 'OI': {
        const vfo = c === 'IF' ? 0 : 1;
        const f = p.slice(5, 14);
        if (/^\d{9}$/.test(f) && ok(vfo ? 'FB' : 'FA')) s.freq[vfo] = +f;
        if (MODE_NAME[p[21]] && ok('MD' + vfo)) s.mode[vfo] = p[21];
        break;
      }
      case 'MD': if (MODE_NAME[p[1]] && ok('MD' + v)) s.mode[v] = p[1]; break;
      // SM: 3 or 4 digit value; RM: 3 digits, optionally followed by 3 more (FTDX-style RMnVVV000)
      case 'SM': this.smSeen = true; s.smeter[v] = Math.min(255, num(1) || 0); break;
      case 'RM': {
        const d = p.slice(1);
        const val = Math.min(255, parseInt(d.length >= 6 ? d.slice(0, 3) : d, 10) || 0);
        if (v === 1 || v === 2) { this.rmSeen = true; s.smeter[v - 1] = val; } else s.meters[v] = val;
        break;
      }
      case 'AG': if (ok('AG' + v)) s.af[v] = num(1, 4); break;
      case 'RG': if (ok('RG' + v)) s.rf[v] = num(1, 4); break;
      case 'SQ': if (ok('SQ' + v)) s.sql[v] = num(1, 4); break;
      case 'PC': if (ok('PC')) { s.pwrHead = v; s.power = parseFloat(p.slice(1)) || 0; } break;
      case 'TX': {
        if (!ok('TX')) break;
        const tx = p[0] !== '0';
        if (!tx && s.tx) Object.keys(s.meters).forEach((k) => { s.meters[k] = 0; });
        s.tx = tx;
        break;
      }
      case 'VS': if (ok('VS')) s.vs = v; break;
      case 'FT': if (ok('FT')) s.ft = v; break;
      case 'FR': if (ok('FR')) s.dual = num(0, 2) === 0; break;
      case 'MG': if (ok('MG')) s.mic = num(0, 3); break;
      case 'KS': if (ok('KS')) s.ks = num(0, 3); break;
      case 'KP': if (ok('KP')) s.kp = num(0, 2); break;
      case 'BI': if (ok('BI')) s.bkin = p[0] === '1'; break;
      case 'VX': if (ok('VX')) s.vox = p[0] === '1'; break;
      case 'VG': if (ok('VG')) s.voxGain = num(0, 3); break;
      case 'ML':
        if (p[0] === '0' && ok('MLo')) s.moniOn = num(1, 4) > 0;
        if (p[0] === '1' && ok('ML')) s.moni = num(1, 4);
        break;
      case 'NL': if (ok('NL' + v)) s.nb[v] = num(1, 4); break;
      case 'RL': if (ok('RL' + v)) s.nr[v] = num(1, 3); break;
      case 'NA': if (ok('NA' + v)) s.nar[v] = p[1] === '1'; break;
      case 'BC': if (ok('BC' + v)) s.bc[v] = p[1] === '1'; break;
      case 'BP':
        if (p[1] === '0' && ok('BPo' + v)) s.notch[v] = num(2, 5) > 0;
        if (p[1] === '1' && ok('BPf' + v)) s.notchHz[v] = num(2, 5) * 10;
        break;
      case 'CO': {
        const val = num(2, 6);
        if (p[1] === '0' && ok('COo' + v)) s.contour[v] = val > 0;
        if (p[1] === '1' && ok('COf' + v)) s.contourHz[v] = val;
        if (p[1] === '2' && ok('COa' + v)) s.apf[v] = val > 0;
        if (p[1] === '3' && ok('COp' + v)) s.apfOfs[v] = (val - 25) * 10;
        break;
      }
      case 'RA': if (ok('RA')) s.att = p[1] === '1'; break;
      case 'PA': if (ok('PA' + v)) s.preamp[v] = +p[1] || 0; break;
      case 'GT': if (ok('GT' + v)) { const g = +p[1]; s.agc[v] = g >= 4 ? 4 : g; } break;
      // IS P1 0 +/- 0000-1200: no on/off flag, so 0 Hz means off (the last offset is kept for toggling back on)
      case 'IS':
        if (ok('IS' + v)) {
          const hz = (p[2] === '-' ? -1 : 1) * (num(3, 7) || 0);
          s.shiftOn[v] = hz !== 0;
          if (hz) s.shift[v] = hz;
        }
        break;
      case 'SH': if (ok('SH' + v)) s.width[v] = num(2, 4); break;
      case 'LK': if (ok('LK')) s.lock = p[0] === '1'; break;
      case 'CS': if (ok('CS')) s.spot = p[0] === '1'; break;
      case 'SS': if (p[0] === '0' && p[1] in s.scope && p[2] && ok('SS' + p[1])) s.scope[p[1]] = p[2]; break;
      case 'AC': if (ok('AC')) s.tuner = !!p[2] && p[2] !== '0'; break;
      case 'CF':
        if (p[2] === '0' && ok('CFs' + v)) { s.clarRx[v] = p[3] === '1'; s.clarTx[v] = p[4] === '1'; }
        if (p[2] === '1' && ok('CFf' + v)) s.clarOfs[v] = (p[3] === '-' ? -1 : 1) * (num(4, 8) || 0);
        break;
      case 'ID': s.id = p; break;
      case 'AI': s.ai = p[0] === '1'; break;
      default: break;
    }
    this._changed();
  }

  // ---- setters ----
  setFreq(vfo, hz) {
    hz = clamp(Math.round(hz), 30000, 470000000);
    const c = vfo ? 'FB' : 'FA';
    this._set(c, `${c}${pad(hz, 9)};`, () => { this.s.freq[vfo] = hz; });
  }
  setMode(vfo, code) { this._set('MD' + vfo, `MD${vfo}${code};`, () => { this.s.mode[vfo] = code; }); }
  setAF(vfo, v) { v = clamp(Math.round(v), 0, 255); this._set('AG' + vfo, `AG${vfo}${pad(v, 3)};`, () => { this.s.af[vfo] = v; }); }
  setRF(vfo, v) { v = clamp(Math.round(v), 0, 255); this._set('RG' + vfo, `RG${vfo}${pad(v, 3)};`, () => { this.s.rf[vfo] = v; }); }
  setSQL(vfo, v) { v = clamp(Math.round(v), 0, 255); this._set('SQ' + vfo, `SQ${vfo}${pad(v, 3)};`, () => { this.s.sql[vfo] = v; }); }

  // PC P1 1: field head, 2: SPA-1 005-100 W. The manual lists 005-010 W for the field head,
  // 0.5 W steps ("PC10.5;") are kept because low power is used in practice.
  powerRange() {
    return this.s.pwrHead === 2 ? { min: 5, max: 100, step: 1 } : { min: 0.5, max: 10, step: 0.5 };
  }
  setPower(w) {
    const { min, max, step } = this.powerRange();
    w = clamp(Math.round(w / step) * step, min, max);
    const head = this.s.pwrHead === 2 ? 2 : 1;
    const body = Number.isInteger(w) ? pad(w, 3) : w.toFixed(1);
    this._set('PC', `PC${head}${body};`, () => { this.s.power = w; });
  }
  setMic(v) { v = clamp(Math.round(v), 0, 100); this._set('MG', `MG${pad(v, 3)};`, () => { this.s.mic = v; }); }
  setKeySpeed(v) { v = clamp(Math.round(v), 4, 60); this._set('KS', `KS${pad(v, 3)};`, () => { this.s.ks = v; }); }
  setPitch(v) { v = clamp(Math.round(v), 0, 75); this._set('KP', `KP${pad(v, 2)};`, () => { this.s.kp = v; }); }
  setBreakIn(on) { this._set('BI', `BI${on ? 1 : 0};`, () => { this.s.bkin = on; }); }
  setVox(on) { this._set('VX', `VX${on ? 1 : 0};`, () => { this.s.vox = on; }); }
  setVoxGain(v) { v = clamp(Math.round(v), 0, 100); this._set('VG', `VG${pad(v, 3)};`, () => { this.s.voxGain = v; }); }
  setMonitor(v) { v = clamp(Math.round(v), 0, 100); this._set('ML', `ML1${pad(v, 3)};`, () => { this.s.moni = v; }); }
  setMonitorOn(on) { this._set('MLo', `ML0${on ? '001' : '000'};`, () => { this.s.moniOn = on; }); }
  setNB(vfo, v) { v = clamp(Math.round(v), 0, 10); this._set('NL' + vfo, `NL${vfo}${pad(v, 3)};`, () => { this.s.nb[vfo] = v; }); }
  setNR(vfo, v) { v = clamp(Math.round(v), 0, 10); this._set('RL' + vfo, `RL${vfo}${pad(v, 2)};`, () => { this.s.nr[vfo] = v; }); }
  setNarrow(vfo, on) { this._set('NA' + vfo, `NA${vfo}${on ? 1 : 0};`, () => { this.s.nar[vfo] = on; }); }
  setBeatCancel(vfo, on) { this._set('BC' + vfo, `BC${vfo}${on ? 1 : 0};`, () => { this.s.bc[vfo] = on; }); }
  setNotch(vfo, on) { this._set('BPo' + vfo, `BP${vfo}0${on ? '001' : '000'};`, () => { this.s.notch[vfo] = on; }); }
  setNotchHz(vfo, hz) {
    hz = clamp(Math.round(hz / 10) * 10, 10, 3200);
    this._set('BPf' + vfo, `BP${vfo}1${pad(hz / 10, 3)};`, () => { this.s.notchHz[vfo] = hz; });
  }
  setContour(vfo, on) { this._set('COo' + vfo, `CO${vfo}0${on ? '0001' : '0000'};`, () => { this.s.contour[vfo] = on; }); }
  setContourHz(vfo, hz) {
    hz = clamp(Math.round(hz / 10) * 10, 10, 3200);
    this._set('COf' + vfo, `CO${vfo}1${pad(hz, 4)};`, () => { this.s.contourHz[vfo] = hz; });
  }
  setAPF(vfo, on) { this._set('COa' + vfo, `CO${vfo}2${on ? '0001' : '0000'};`, () => { this.s.apf[vfo] = on; }); }
  setAPFOffset(vfo, hz) {
    hz = clamp(Math.round(hz / 10) * 10, -250, 250);
    this._set('COp' + vfo, `CO${vfo}3${pad(hz / 10 + 25, 4)};`, () => { this.s.apfOfs[vfo] = hz; });
  }
  setAtt(on) { this._set('RA', `RA0${on ? 1 : 0};`, () => { this.s.att = on; }); }
  setPreamp(v, hz = this.s.freq[this.s.vs]) {
    const bt = bandType(hz);
    v = clamp(v, 0, bt === 0 ? 2 : 1);
    this._set('PA' + bt, `PA${bt}${v};`, () => { this.s.preamp[bt] = v; });
  }
  setAGC(vfo, v) { v = clamp(v, 0, 4); this._set('GT' + vfo, `GT${vfo}${v};`, () => { this.s.agc[vfo] = v; }); }
  // IS P1 0 +/- 0000-1200 (20 Hz steps); "off" is sent as 0 Hz
  setShift(vfo, on, hz) {
    hz = clamp(Math.round(hz / 20) * 20, -1200, 1200);
    const out = on ? hz : 0;
    this._set('IS' + vfo, `IS${vfo}0${out < 0 ? '-' : '+'}${pad(Math.abs(out), 4)};`, () => {
      this.s.shiftOn[vfo] = on && hz !== 0; if (hz) this.s.shift[vfo] = hz;
    });
  }
  setWidth(vfo, code) { code = clamp(code, 0, widthMax(this.s.mode[vfo])); this._set('SH' + vfo, `SH${vfo}0${pad(code, 2)};`, () => { this.s.width[vfo] = code; }); }
  setSpot(on) { this._set('CS', `CS${on ? 1 : 0};`, () => { this.s.spot = on; }); }
  zeroIn(vfo) { this.send(`ZI${vfo};`); }
  // SS P1=0 P2 P3 P4-P7=0000 (P2: 0 SPEED, 5 SPAN, 6 MODE)
  setScope(item, code) { this._set('SS' + item, `SS0${item}${code}0000;`, () => { this.s.scope[item] = String(code); }); }
  // memory keys: [V/M] (VM), MAIN -> memory write (AM), memory -> MAIN VFO (MA), memory tune (VM P2=10)
  vmKey() { this.send('VM;'); this._refreshVfo(0); }
  memWrite() { this.send('AM;'); }
  memToVfo() { this.send('MA;'); this._refreshVfo(0); }
  memTune(vfo = 0) { this.send(`VM${vfo}10;`); this._refreshVfo(vfo); }
  setLock(on) { this._set('LK', `LK${on ? 1 : 0};`, () => { this.s.lock = on; }); }
  selectVFO(v) { this._set('VS', `VS${v};`, () => { this.s.vs = v; }); }
  setTxVFO(v) { this._set('FT', `FT${v};`, () => { this.s.ft = v; }); }
  setDual(on) { this._set('FR', `FR0${on ? 0 : 1};`, () => { this.s.dual = on; }); }
  setTuner(on) { this._set('AC', `AC00${on ? 1 : 0};`, () => { this.s.tuner = on; }); }
  tune() { this._set('AC', 'AC003;', () => { this.s.tuner = true; }); }
  setClar(vfo, rx, tx) {
    this._set('CFs' + vfo, `CF${vfo}00${rx ? 1 : 0}${tx ? 1 : 0}000;`, () => { this.s.clarRx[vfo] = rx; this.s.clarTx[vfo] = tx; });
  }
  setClarOffset(vfo, hz) {
    hz = clamp(Math.round(hz), -9999, 9999);
    this._set('CFf' + vfo, `CF${vfo}01${hz < 0 ? '-' : '+'}${pad(Math.abs(hz), 4)};`, () => { this.s.clarOfs[vfo] = hz; });
  }

  swap() {
    this.send('SV;');
    const s = this.s;
    [s.freq[0], s.freq[1]] = [s.freq[1], s.freq[0]];
    [s.mode[0], s.mode[1]] = [s.mode[1], s.mode[0]];
    this._hold('FA'); this._hold('FB'); this._hold('MD0'); this._hold('MD1');
    this._changed();
    setTimeout(() => ['FA;', 'FB;', 'MD0;', 'MD1;'].forEach((c) => this.send(c)), 300);
  }
  copyAtoB() { this.send('AB;'); setTimeout(() => ['FB;', 'MD1;'].forEach((c) => this.send(c)), 200); }
  copyBtoA() { this.send('BA;'); setTimeout(() => ['FA;', 'MD0;'].forEach((c) => this.send(c)), 200); }
  bandSelect(vfo, code) { this.send(`BS${vfo}${pad(code, 2)};`); this._refreshVfo(vfo); }
  bandStep(vfo, up) { this.send(`B${up ? 'U' : 'D'}${vfo};`); this._refreshVfo(vfo); }
  _refreshVfo(vfo) { setTimeout(() => [vfo ? 'FB;' : 'FA;', `MD${vfo};`].forEach((c) => this.send(c)), 250); }

  ptt(on, cmd = 1) {
    // PTT jumps the queue: drop pending polls and any older PTT command so only the latest state goes out
    this.queue = this.queue.filter((q) => !q.poll && !q.ptt);
    this.queue.unshift({ cmd: `TX${on ? cmd : 0};`, ptt: true });
    this.s.tx = on;
    this._hold('TX', 400);
    this._pump();
    this._changed();
  }

  // The FTX-1 has no direct CW text command: write up to 50 chars into keyer TEXT memory (KM, '}'-terminated)
  // and play it back with KY0n. This overwrites the radio's CW TEXT memory CW_SLOT.
  async sendCW(text, signal) {
    const CW_SLOT = 5;
    text = text.toUpperCase().replace(/[^A-Z0-9 /?.,=+\-@()'"!:&]/g, '');
    for (let i = 0; i < text.length; i += 50) {
      if (signal?.aborted) return;
      const chunk = text.slice(i, i + 50);
      this.send(`KM${CW_SLOT}${chunk}};`);
      this.send(`KY0${CW_SLOT};`);
      // ~10 dit units per char on average at PARIS timing
      const ms = chunk.length * 10 * (1200 / this.s.ks) + 200;
      await new Promise((r) => {
        const t = setTimeout(r, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
      });
    }
  }
  stopCW() { this.send('KY00;'); }
}
