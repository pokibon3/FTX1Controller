import {
  FTX1, MODES, MODE_NAME, BANDS, bandOf, bandType, AGC, PREAMP_HF,
  widthText, widthHz, widthMax, sText, S_TICKS, isCW, isFM,
} from './ftx1.js';
import { SerialLink } from './serial.js';
import { AudioEngine, isRadioDevice } from './audio.js';
import { Knob, Dial } from './knob.js';
import { AfScope } from './scope.js';
import { FtxMeter } from './ftxmeter.js';
import { FilterDisplay } from './filterdisp.js';
import { APP_VERSION } from './version.js';
import { CwDecoder } from './cwdecoder.js';
import { installDigitGlyphs } from './digits.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const val = (x) => (typeof x === 'function' ? x() : x);

const radio = new FTX1();
const s = radio.s;
const audio = new AudioEngine();
const scope = new AfScope($('#scope'));
const filters = [new FilterDisplay($('#filt0')), new FilterDisplay($('#filt1'))];
const meters = [new FtxMeter($('#meter0')), new FtxMeter($('#meter1'))];

// ---------------- settings ----------------
const DEFAULTS = {
  catBaud: 'auto', step: 'auto', dialRes: 250, pttMethod: 'cat1', tot: 180,
  rxIn: '', rxOut: '', txIn: '', txOut: '', rxVol: 0.8, txGain: 1, txGate: true,
  showPoll: false, scopeSpan: 3000, func: 'af', meterSel: 5, layout: 'lr', layoutV2: true,
  cwMem: ['CQ CQ CQ DE ', '', '', '', ''], bandStack: {}, latch: false, qmb: [],
  sidebar: true, sections: {}, afFft: true, dec: true, decCh: 'L', decGain: 0, console: false,
};
const cfg = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ftx1.cfg') || '{}') }; } catch { return { ...DEFAULTS }; }
})();
if (!['auto', 1, 10, 20, 50, 100, 200, 500, 1000, 2500, 5000, 6250, 10000, 12500, 25000].includes(cfg.step)) cfg.step = 'auto';
if (![3, 4, 5, 6, 7, 8].includes(cfg.meterSel)) cfg.meterSel = 5;
// v1.6: the default screen became L/R (as on the radio); switch saved settings over once
if (!cfg.layoutV2) { cfg.layout = 'lr'; cfg.layoutV2 = true; }
function save() { try { localStorage.setItem('ftx1.cfg', JSON.stringify(cfg)); } catch {} }

const STEPS = ['auto', 1, 10, 50, 100, 500, 1000, 2500, 5000, 6250, 10000, 12500, 25000];
const LAYOUTS = ['lr', 'ud', 'single'];
const ui = {
  fine: false, fast: false, ptt: false, cwAbort: null, pttLink: null, totTimer: null,
  pop: null, target: null, knMode: ['af', 'af'],
};

// target VFO for screens/FUNC: the band whose mode box was touched, else the selected one
const V = () => ui.target ?? s.vs;
const side = (v = V()) => (v ? 'SUB' : 'MAIN');
const pct255 = (v) => `${Math.round(v / 2.55)}`;
const signed = (v, unit) => `${v > 0 ? '+' : ''}${v}${unit}`;

// ---------------- toast ----------------
let toastTimer;
function toast(msg, err = false, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------- parameters (FUNC knob targets) ----------------
const PARAMS = {
  af: { name: () => `AF GAIN ${side()}`, get: () => s.af[V()], set: (v) => radio.setAF(V(), v), min: 0, max: 255, step: 3, fmt: pct255 },
  rf: { name: () => `RF GAIN ${side()}`, get: () => s.rf[V()], set: (v) => radio.setRF(V(), v), min: 0, max: 255, step: 3, fmt: pct255 },
  sql: { name: () => `SQL ${side()}`, get: () => s.sql[V()], set: (v) => radio.setSQL(V(), v), min: 0, max: 255, step: 3, fmt: pct255 },
  power: {
    name: 'RF POWER', get: () => s.power, set: (v) => radio.setPower(v),
    min: () => radio.powerRange().min, max: () => radio.powerRange().max, step: () => radio.powerRange().step, fmt: (v) => `${v}W`,
  },
  mic: { name: 'MIC GAIN', get: () => s.mic, set: (v) => radio.setMic(v), min: 0, max: 100, step: 1, fmt: String },
  width: { name: () => `WIDTH ${side()}`, get: () => s.width[V()], set: (v) => radio.setWidth(V(), v), min: 0, max: () => widthMax(s.mode[V()]), step: 1, fmt: (v) => widthText(s.mode[V()], v) },
  shift: { name: () => `SHIFT ${side()}`, get: () => s.shift[V()], set: (v) => radio.setShift(V(), true, v), min: -1200, max: 1200, step: 20, fmt: (v) => signed(v, 'Hz') },
  nb: { name: () => `NB LEVEL ${side()}`, get: () => s.nb[V()], set: (v) => radio.setNB(V(), v), min: 0, max: 10, step: 1, fmt: (v) => (v ? String(v) : 'OFF') },
  nr: { name: () => `DNR LEVEL ${side()}`, get: () => s.nr[V()], set: (v) => radio.setNR(V(), v), min: 0, max: 10, step: 1, fmt: (v) => (v ? String(v) : 'OFF') },
  contour: { name: () => `CONTOUR ${side()}`, get: () => s.contourHz[V()], set: (v) => radio.setContourHz(V(), v), min: 10, max: 3200, step: 20, fmt: (v) => `${v}Hz` },
  apf: { name: () => `APF ${side()}`, get: () => s.apfOfs[V()], set: (v) => radio.setAPFOffset(V(), v), min: -250, max: 250, step: 10, fmt: (v) => signed(v, 'Hz') },
  notch: { name: () => `NOTCH ${side()}`, get: () => s.notchHz[V()], set: (v) => radio.setNotchHz(V(), v), min: 10, max: 3200, step: 10, fmt: (v) => `${v}Hz` },
  ks: { name: 'CW SPEED', get: () => s.ks, set: (v) => radio.setKeySpeed(v), min: 4, max: 60, step: 1, fmt: (v) => `${v}wpm` },
  kp: { name: 'CW PITCH', get: () => s.kp, set: (v) => radio.setPitch(v), min: 0, max: 75, step: 1, fmt: (v) => `${300 + v * 10}Hz` },
  voxGain: { name: 'VOX GAIN', get: () => s.voxGain, set: (v) => radio.setVoxGain(v), min: 0, max: 100, step: 1, fmt: String },
  moni: { name: 'MONI LEVEL', get: () => s.moni, set: (v) => radio.setMonitor(v), min: 0, max: 100, step: 1, fmt: String },
  // the radio's own FUNC-knob functions (SF), adjusted over SS / DA / PL / AO / VD / SD
  dlevel: { name: 'D-LEVEL', get: () => s.scope[4], set: (v) => radio.setScopeLevel(v), min: -30, max: 30, step: 0.5, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB` },
  dpeak: { name: 'D-PEAK', get: () => +s.scope[1], set: (v) => radio.setScope(1, v), min: 0, max: 4, step: 1, fmt: (v) => `LV${v + 1}` },
  dcolor: { name: 'D-COLOR', get: () => parseInt(s.scope[3], 16) || 0, set: (v) => radio.setScope(3, v.toString(16).toUpperCase()), min: 0, max: 10, step: 1, fmt: (v) => `COLOR-${v + 1}` },
  contrast: { name: 'D-CONTRAST', get: () => s.dim[0], set: (v) => radio.setDim(0, v), min: 0, max: 20, step: 1, fmt: String },
  dimmer: { name: 'DIMMER', get: () => s.dim[1], set: (v) => radio.setDim(1, v), min: 0, max: 20, step: 1, fmt: String },
  proc: { name: 'PROC LEVEL', get: () => s.proc, set: (v) => radio.setProc(v), min: 0, max: 100, step: 1, fmt: (v) => (v ? String(v) : 'OFF') },
  amc: { name: 'AMC LEVEL', get: () => s.amc, set: (v) => radio.setAmc(v), min: 1, max: 100, step: 1, fmt: String },
  voxDelay: { name: 'VOX DELAY', get: () => s.voxDelay, set: (v) => radio.setVoxDelay(v), min: 0, max: 33, step: 1, fmt: (v) => `${delayMs(v)}ms` },
  bkDelay: { name: 'BK-DELAY', get: () => s.bkDelay, set: (v) => radio.setBkDelay(v), min: 0, max: 33, step: 1, fmt: (v) => `${delayMs(v)}ms` },
  clar: {
    name: () => `CLAR ${side()}`, get: () => s.clarOfs[V()], min: -9999, max: 9999, step: 10, fmt: (v) => signed(v, 'Hz'),
    set: (v) => {
      radio.setClarOffset(V(), v);
      if (!s.clarRx[V()] && !s.clarTx[V()]) radio.setClar(V(), true, false);
    },
  },
};

// VD / SD code -> ms (00 30, 01 50, 02-05 100-250, 06-33 300-3000)
const delayMs = (c) => [30, 50, 100, 150, 200, 250][c] ?? (c - 3) * 100;
function paramText(key) { const p = PARAMS[key]; return p.fmt(p.get()); }
function paramFrac(key) {
  const p = PARAMS[key], lo = val(p.min), hi = val(p.max);
  return (p.get() - lo) / (hi - lo || 1);
}
function adjust(key, n) {
  const p = PARAMS[key];
  const step = val(p.step) || 1;
  const v = clamp(Math.round((p.get() + n * step) / step) * step, val(p.min), val(p.max));
  p.set(+v.toFixed(2));
  popup(val(p.name), p.fmt(p.get()), paramFrac(key));
}
// FUNC knob functions the radio knows (SF P2), and the app parameter each one drives
const SF_NAME = { 1: 'D-LEVEL', 2: 'D-PEAK', 3: 'D-COLOR', 4: 'D-CONTRAST', 5: 'DIMMER', 7: 'MIC GAIN', 8: 'PROC LEVEL',
  9: 'AMC LEVEL', A: 'VOX GAIN', B: 'VOX DELAY', D: 'RF POWER', E: 'MONI LEVEL', F: 'CW SPEED', G: 'CW PITCH', H: 'BK-DELAY' };
const SF_OF_PARAM = { dlevel: '1', dpeak: '2', dcolor: '3', contrast: '4', dimmer: '5', mic: '7', proc: '8', amc: '9',
  voxGain: 'A', voxDelay: 'B', power: 'D', moni: 'E', ks: 'F', kp: 'G', bkDelay: 'H' };
const PARAM_OF_SF = Object.fromEntries(Object.entries(SF_OF_PARAM).map(([k, c]) => [c, k]));
// the knob follows the radio when the radio's function has an app parameter; radio-only ones (D-LEVEL ...) are shown
ui.sfSeen = '';
radio.addEventListener('change', () => {
  if (!radio.connected || s.sf === ui.sfSeen) return;
  ui.sfSeen = s.sf;
  if (PARAM_OF_SF[s.sf]) { cfg.func = PARAM_OF_SF[s.sf]; ui.funcRadioOnly = false; save(); }
  else if (SF_NAME[s.sf]) ui.funcRadioOnly = true;
});
const funcName = () => (radio.connected && ui.funcRadioOnly ? SF_NAME[s.sf] : val(PARAMS[cfg.func].name).replace(/ (MAIN|SUB)$/, ''));
function assignFunc(key) {
  cfg.func = key;
  ui.funcRadioOnly = false;
  if (SF_OF_PARAM[key] && radio.connected) { radio.setFuncKnob(SF_OF_PARAM[key]); ui.sfSeen = SF_OF_PARAM[key]; }
  save();
  popup(val(PARAMS[key].name), paramText(key), paramFrac(key));
  render();
}

// ---------------- FUNC value popup ----------------
let popupTimer;
function popup(label, value, frac) {
  $('#popupLabel').textContent = label;
  $('#popupValue').textContent = value;
  $('#popupBar').style.width = `${clamp(frac, 0, 1) * 100}%`;
  $('#popup').hidden = false;
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => { $('#popup').hidden = true; }, 3000); // FTX-1 confirms after ~3 s
}

// ---------------- band handling ----------------
function gotoBand(b, v = V()) {
  const cur = bandOf(s.freq[v]);
  if (cur.code !== 11) cfg.bandStack[cur.code] = { f: s.freq[v], m: s.mode[v] };
  save();
  const local = () => {
    const st = cfg.bandStack[b.code] || { f: b.def, m: b.mode };
    if (!st.f) return;
    radio.setFreq(v, st.f);
    if (st.m) radio.setMode(v, st.m);
  };
  if (!radio.connected) { local(); return; }
  radio.bandSelect(v, b.code);
  // firmware without BS support: fall back to the local band stack
  setTimeout(() => { if (bandOf(s.freq[v]).code !== b.code && b.code !== 11) local(); }, 800);
}
function bandStep(up, v = V()) {
  if (radio.connected) { radio.bandStep(v, up); return; }
  const ham = BANDS.filter((b) => b.code !== 11 && b.code !== 12);
  const i = ham.findIndex((b) => b.code === bandOf(s.freq[v]).code);
  gotoBand(ham[(i + (up ? 1 : -1) + ham.length) % ham.length], v);
}

// ---------------- selection screens (opened from the bottom soft keys) ----------------
// item: { label, value?, on?, cur?, act?, func?, close? } — tap runs act and/or assigns the FUNC knob
const preampVal = (v = V()) => s.preamp[bandType(s.freq[v])] || 0;
const preampText = (v = V()) => (bandType(s.freq[v]) ? (preampVal(v) ? 'ON' : 'OFF') : PREAMP_HF[preampVal(v)]);
const cyclePreamp = (v = V()) => radio.setPreamp((preampVal(v) + 1) % (bandType(s.freq[v]) ? 2 : 3), s.freq[v]);
const isSplit = () => s.ft !== s.vs;
function toggleSplit() { radio.setTxVFO(isSplit() ? s.vs : 1 - s.vs); }
const onOff = (b) => (b ? 'ON' : 'OFF');

const METERS = { 5: 'PO', 3: 'COMP', 4: 'ALC', 8: 'VDD', 7: 'ID', 6: 'SWR' };
// MS P1/P2 codes <-> RM meter numbers
const MS_TO_RM = { 0: 5, 1: 3, 2: 4, 3: 8, 4: 7, 5: 6 };
const RM_TO_MS = Object.fromEntries(Object.entries(MS_TO_RM).map(([m, r]) => [r, m]));
function setMeterSel(rm) {
  cfg.meterSel = rm;
  save();
  if (radio.connected) radio.setMeterSel(RM_TO_MS[rm], RM_TO_MS[rm]);
}
radio.addEventListener('change', () => {
  const rm = MS_TO_RM[s.ms[s.ft]];
  if (radio.connected && rm && rm !== cfg.meterSel) { cfg.meterSel = rm; save(); }
});

// radio scope (SS) codes; MODE codes combine the display type with CENTER/CURSOR/FIX
const SC_DMODE = ['CENTER', 'CURSOR', 'FIX'];
const SC_MODE_CODE = { '3DSS': ['0', '1', '2'], 'W/F': ['4', '7', 'A'] };
const scopeType = () => (['4', '7', 'A'].includes(s.scope[6]) ? 'W/F' : '3DSS');
const scopeDmode = () => Math.max(0, SC_MODE_CODE[scopeType()].indexOf(s.scope[6]));
const setScopeMode = (type, dmode) => radio.setScope(6, SC_MODE_CODE[type][dmode]);
const SC_SPAN = { 2: '5k', 3: '10k', 4: '20k', 5: '50k', 6: '100k', 7: '200k', 8: '500k', 9: '1M' };
const SC_SPEED = ['SLOW1', 'SLOW2', 'FAST1', 'FAST2', 'FAST3', 'STOP'];

const SCREENS = {
  // [FUNC] knob press: function menu in the manual's order (SSB page, then CW page).
  // Items the CAT protocol cannot reach are left out; VFO items at the end are this app's additions.
  FUNCTION: {
    items: () => [
      { section: 'SSB' },
      { label: 'D-LEVEL', func: 'dlevel' },
      { label: 'D-PEAK', func: 'dpeak' },
      { label: 'D-COLOR', func: 'dcolor' },
      { label: 'CONTRAST', func: 'contrast' },
      { label: 'DIMMER', func: 'dimmer' },
      { label: 'ATT', value: () => onOff(s.att), on: () => s.att, act: () => radio.setAtt(!s.att) },
      { label: () => (bandType(s.freq[V()]) ? 'AMP' : 'IPO'), value: () => preampText(), on: () => preampVal() > 0, act: () => cyclePreamp() },
      { label: 'DNF', value: () => onOff(s.bc[V()]), on: () => s.bc[V()], act: () => radio.setBeatCancel(V(), !s.bc[V()]) },
      { label: 'AGC', value: () => AGC[s.agc[V()]], act: () => radio.setAGC(V(), (s.agc[V()] + 1) % 5) },
      { label: 'ANT TUNE', value: () => 'START', act: () => radio.tune() },
      { label: 'TUNER', value: () => onOff(s.tuner), on: () => s.tuner, act: () => radio.setTuner(!s.tuner) },
      { label: 'NB', func: 'nb', on: () => s.nb[V()] > 0, act: () => radio.setNB(V(), s.nb[V()] ? 0 : (ui.lastNb || 5)) },
      { label: 'DNR', func: 'nr', on: () => s.nr[V()] > 0, act: () => radio.setNR(V(), s.nr[V()] ? 0 : (ui.lastNr || 5)) },
      { label: 'PROC LEVEL', func: 'proc' },
      { label: 'RF POWER', func: 'power' },
      { label: 'MIC GAIN', func: 'mic' },
      { label: 'AMC LEVEL', func: 'amc' },
      { label: 'VOX', value: () => onOff(s.vox), on: () => s.vox, act: () => radio.setVox(!s.vox) },
      { label: 'VOX GAIN', func: 'voxGain' },
      { label: 'VOX DELAY', func: 'voxDelay' },
      { section: 'CW' },
      { label: 'MONI LEVEL', func: 'moni', on: () => s.moniOn, act: () => radio.setMonitorOn(!s.moniOn) },
      { label: 'BK-IN', value: () => onOff(s.bkin), on: () => s.bkin, act: () => radio.setBreakIn(!s.bkin) },
      { label: 'CW SPEED', func: 'ks' },
      { label: 'CW PITCH', func: 'kp' },
      { label: 'BK-DELAY', func: 'bkDelay' },
      { label: 'ZIN', value: () => 'ZERO IN', act: () => radio.zeroIn(V()) },
      { label: 'CW SPOT', value: () => onOff(s.spot), on: () => s.spot, act: () => radio.setSpot(!s.spot) },
      { section: 'VFO' },
      { label: 'MAIN⇔SUB', value: () => 'VS', act: () => radio.selectVFO(1 - s.vs) },
      { label: 'A⇄B', value: () => 'SWAP', act: () => radio.swap() },
      { label: 'A▸B', value: () => 'COPY', act: () => radio.copyAtoB() },
      { label: 'B▸A', value: () => 'COPY', act: () => radio.copyBtoA() },
      { label: 'DUAL RX', value: () => onOff(s.dual), on: () => s.dual, act: () => radio.setDual(!s.dual) },
      { label: 'LOCK', value: () => onOff(s.lock), on: () => s.lock, act: () => radio.setLock(!s.lock) },
      { label: 'CLAR', func: 'clar', on: () => s.clarRx[V()] || s.clarTx[V()] },
      { label: 'DIAL STEP', value: () => (cfg.step === 'auto' ? 'AUTO' : stepText(cfg.step)), act: () => ACTIONS.step() },
      { label: 'RF GAIN', func: 'rf' },
      { label: 'SQL', func: 'sql' },
    ],
  },
  SPAN: {
    items: () => Object.entries(SC_SPAN).map(([c, t]) => ({ label: t, cur: () => s.scope[5] === c, act: () => radio.setScope(5, c), close: true })),
  },
  SPEED: {
    items: () => SC_SPEED.map((t, i) => ({ label: t, cur: () => s.scope[0] === String(i), act: () => radio.setScope(0, i), close: true })),
  },
  MODE: {
    key: () => MODE_NAME[s.mode[V()]] || '---',
    items: () => MODES.map((m) => ({ label: m.name, cur: () => s.mode[V()] === m.code, act: () => radio.setMode(V(), m.code), close: true })),
  },
  BAND: {
    key: () => bandOf(s.freq[V()]).label + (bandOf(s.freq[V()]).code < 11 || bandOf(s.freq[V()]).code > 12 ? 'M' : ''),
    items: () => [
      ...BANDS.map((b) => ({ label: b.label, value: () => b.name, cur: () => bandOf(s.freq[V()]).code === b.code, act: () => gotoBand(b), close: true })),
    ],
  },
  FILTER: {
    key: () => `W ${widthText(s.mode[V()], s.width[V()])}`,
    items: () => [
      { label: 'WIDTH', func: 'width' },
      { label: 'SHIFT', func: 'shift', on: () => s.shiftOn[V()], act: () => radio.setShift(V(), !s.shiftOn[V()], s.shift[V()]) },
      { label: 'NARROW', value: () => onOff(s.nar[V()]), on: () => s.nar[V()], act: () => radio.setNarrow(V(), !s.nar[V()]) },
      { label: 'CONTOUR', func: 'contour', on: () => s.contour[V()], act: () => radio.setContour(V(), !s.contour[V()]) },
      { label: 'APF', func: 'apf', on: () => s.apf[V()], act: () => radio.setAPF(V(), !s.apf[V()]) },
      { label: 'NOTCH', func: 'notch', on: () => s.notch[V()], act: () => radio.setNotch(V(), !s.notch[V()]) },
    ],
  },
  METER: {
    key: () => METERS[cfg.meterSel],
    items: () => Object.entries(METERS).map(([k, name]) => ({
      label: name, cur: () => cfg.meterSel === +k, act: () => { setMeterSel(+k); }, close: true,
    })),
  },
};

let popItems = [];
function openPop(name, target = null) {
  if (ui.pop === name && target === ui.target) { closePop(); return; }
  ui.pop = name;
  ui.target = target;
  $('#popTitle').textContent = target == null ? name : `${name}  ${side(target)}`;
  const grid = $('#popGrid');
  grid.innerHTML = '';
  popItems = SCREENS[name].items().map((it) => {
    if (it.section) {
      const h = document.createElement('div');
      h.className = 'ph';
      h.textContent = it.section;
      grid.appendChild(h);
      return null;
    }
    const el = document.createElement('button');
    el.className = 'pt';
    el.innerHTML = '<b></b><span></span>';
    el.addEventListener('click', () => {
      it.act?.();
      if (it.func) assignFunc(it.func);
      if (it.close) setTimeout(closePop, 350);
      render();
    });
    grid.appendChild(el);
    return { it, el, b: el.firstChild, span: el.lastChild };
  }).filter(Boolean);
  $('#pop').hidden = false;
  render();
}
function closePop() {
  ui.pop = null;
  ui.target = null;
  $('#pop').hidden = true;
  render();
}
function updatePop() {
  for (const { it, el, b, span } of popItems) {
    b.textContent = val(it.label);
    span.textContent = it.func ? paramText(it.func) : (it.value ? it.value() : '');
    el.classList.toggle('on', !!it.on?.());
    el.classList.toggle('cur', !!it.cur?.());
    el.classList.toggle('func', it.func === cfg.func);
  }
}

// bottom touch keys of the scope screen (manual p.28-30, product photo):
// D-MODE / 3DSS / SPAN / SPEED drive the radio's own scope over CAT (SS); MULTI shows/hides this app's AF-FFT;
// SCOPE MAIN/SUB follows the operated side (the CAT protocol has no scope-side command).
const SOFT_KEYS = [
  { name: 'D-MODE', key: () => SC_DMODE[scopeDmode()], act: () => setScopeMode(scopeType(), (scopeDmode() + 1) % 3) },
  { name: () => scopeType(), key: () => '', act: () => setScopeMode(scopeType() === '3DSS' ? 'W/F' : '3DSS', scopeDmode()) },
  { name: 'MULTI', key: () => (cfg.afFft ? 'AF-FFT' : ''), act: () => { cfg.afFft = !cfg.afFft; save(); } },
  { name: 'SCOPE', key: () => side(s.vs), act: () => radio.selectVFO(1 - s.vs) },
  { name: 'SPAN', key: () => SC_SPAN[s.scope[5]] || '', pop: 'SPAN' },
  { name: 'SPEED', key: () => SC_SPEED[+s.scope[0]] || '', pop: 'SPEED' },
];
let softKeys = [];
function setupSoftbar() {
  const bar = $('#softbar');
  softKeys = SOFT_KEYS.map((k) => {
    const el = document.createElement('button');
    el.className = 'sk';
    el.innerHTML = '<b></b><span></span>';
    el.addEventListener('click', () => { if (k.pop) openPop(k.pop); else { k.act(); render(); } });
    bar.appendChild(el);
    return { k, el, b: el.firstChild, span: el.lastChild };
  });
  $('#popClose').addEventListener('click', closePop);
  // touching the filter display opens the filter functions (manual p.23)
  for (let v = 0; v < 2; v++) $(`#filt${v}`).addEventListener('click', () => openPop('FILTER', v));
}

// ---------------- bands: frequency, tags, receiver settings ----------------
const lastFreqHtml = ['', ''];
function freqHtml(hz) {
  const str = String(hz).padStart(9, '0');
  // glyphs are CSS masks (js/digits.js); the spans stay empty so each one is exactly one glyph box
  const d = (i, cls = '') => `<span class="d${cls}" data-g="${str[i]}" data-p="${10 ** (8 - i)}"></span>`;
  let mhz = '';
  for (let i = 0; i < 3; i++) if (mhz || str[i] !== '0' || i === 2) mhz += d(i);
  let khz = '';
  for (let i = 3; i < 6; i++) khz += d(i);
  let hzs = '';
  for (let i = 6; i < 9; i++) hzs += d(i);
  return `${mhz}<span class="dot"></span>${khz}<span class="sm"><span class="dot"></span>${hzs}</span>`;
}
// Frequency sizing.
// L/R screen (the radio's default): full size, and a 3-digit MHz reading at ~0.8 of it (manual p.17).
// U/D and single screens: as in the manual's pictures (p.18), a reading that does not fit its area
// (e.g. 144.000.000) is drawn smaller; one that fits keeps the full size.
function fitFreq() {
  const els = [$('#freq0'), $('#freq1')];
  const lr = $('#lcd').classList.contains('lay-lr');
  for (const el of els) {
    el.style.transform = '';
    el.style.fontSize = '';
    const box = el.parentElement;
    if (!box.offsetParent || !box.clientWidth) continue; // hidden band (single layout)
    const cs = getComputedStyle(box);
    const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (lr) {
      // manual p.17: a 3-digit MHz reading (145.000.000) is drawn at ~0.8 of the size, same proportions
      let k = s.freq[+el.id.slice(-1)] >= 100e6 ? 0.8 : 1;
      if (el.scrollWidth * k > avail) k = avail / el.scrollWidth;
      if (k < 1) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * k}px`;
    } else if (el.scrollWidth > avail) {
      el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * avail) / el.scrollWidth * 0.98}px`;
    }
  }
}

const RX_TILES = [
  { label: (v) => 'ATT', na: (v) => !!bandType(s.freq[v]), value: (v) => (bandType(s.freq[v]) ? '' : onOff(s.att)), act: (v) => { if (!bandType(s.freq[v])) radio.setAtt(!s.att); } },
  { label: (v) => (bandType(s.freq[v]) ? 'AMP' : 'IPO'), value: (v) => preampText(v), act: (v) => cyclePreamp(v) },
  { label: () => 'DNF', na: (v) => isFM(s.mode[v]), value: (v) => (isFM(s.mode[v]) ? '' : onOff(s.bc[v])), act: (v) => radio.setBeatCancel(v, !s.bc[v]) },
  { label: () => 'AGC', value: (v) => AGC[s.agc[v]], act: (v) => radio.setAGC(v, (s.agc[v] + 1) % 5) },
];
const rxTileEls = [[], []];

function setupBands() {
  for (let v = 0; v < 2; v++) {
    const band = $(`#band${v}`);
    const fel = $(`#freq${v}`);
    fel.addEventListener('click', () => openEntry(v));
    fel.addEventListener('wheel', (e) => {
      const d = e.target.closest('.d');
      if (!d) return;
      e.preventDefault();
      if (s.lock) return;
      const place = +d.dataset.p;
      radio.setFreq(v, s.freq[v] + (e.deltaY < 0 ? place : -place));
    }, { passive: false });
    band.querySelector('.b-mode').addEventListener('click', () => openPop('MODE', v));
    band.querySelector('.b-tags').addEventListener('click', () => { if (s.vs !== v) radio.selectVFO(v); });
    $(`#meter${v}`).addEventListener('click', () => openPop('METER'));
    const rx = $(`#rx${v}`);
    RX_TILES.forEach((t) => {
      const el = document.createElement('button');
      el.className = 'rxt';
      el.innerHTML = '<b></b><span></span>';
      el.addEventListener('click', () => { t.act(v); render(); });
      rx.appendChild(el);
      rxTileEls[v].push({ t, el, b: el.firstChild, span: el.lastChild });
    });
    new ResizeObserver(() => fitFreq()).observe(band);
  }
  $('#funcBox').addEventListener('click', () => popup(funcName(), paramText(cfg.func), paramFrac(cfg.func)));
  document.fonts?.ready.then(() => { fitFreq(0); fitFreq(1); });
}

// ---------------- keypad frequency entry ----------------
let entryBuf = '';
function openEntry(v) {
  if (s.lock) return;
  const dlg = $('#entryDlg');
  $('#entryVfo').textContent = side(v);
  entryBuf = '';
  $('#entryShow').textContent = (s.freq[v] / 1e6).toFixed(3);
  dlg.dataset.vfo = v;
  dlg.showModal();
}
function entryKey(k) {
  if (k === 'bs') entryBuf = entryBuf.slice(0, -1);
  else if (k === 'ce') entryBuf = '';
  else if (k === '.' && entryBuf.includes('.')) return;
  else if (entryBuf.replace('.', '').length < 9) entryBuf += k;
  $('#entryShow').textContent = entryBuf || '-';
  $('#entryInput').value = entryBuf;
}
function parseFreq(text) {
  const t = text.trim();
  if (!t) return null;
  const n = parseFloat(t);
  if (!isFinite(n) || n <= 0) return null;
  // FTX-1 keypad entry is in MHz; long digit runs without a point are taken as Hz/kHz
  if (t.includes('.') || n < 1000) return Math.round(n * 1e6);
  if (n < 1e6) return Math.round(n * 1e3);
  return Math.round(n);
}
function setupEntry() {
  $$('#keypad [data-k]').forEach((b) => b.addEventListener('click', () => entryKey(b.dataset.k)));
  const dlg = $('#entryDlg');
  dlg.addEventListener('keydown', (e) => {
    if (/^[0-9.]$/.test(e.key)) { entryKey(e.key); e.preventDefault(); }
    if (e.key === 'Backspace') { entryKey('bs'); e.preventDefault(); }
    if (e.key === 'Enter') { e.preventDefault(); dlg.close('ok'); }
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok' || !entryBuf) return;
    const hz = parseFreq(entryBuf);
    if (hz && hz >= 30000 && hz <= 470e6) radio.setFreq(+dlg.dataset.vfo, hz);
    else toast('周波数が範囲外です (30kHz–470MHz)', true);
  });
}

// ---------------- meters ----------------
// Tick lists are [label, raw, minor?] on the shared 0..255 needle sweep.
const S_SCALE = {
  name: 'S', hot: 130, hotColor: '#8c8eff', unit: 'dB', unitAbove: true, unitHot: true,
  ticks: [...S_TICKS, ['', 27, 1], ['', 55, 1], ['', 80, 1], ['', 112, 1], ['', 150, 1], ['', 190, 1], ['', 240, 1], ['', 0, 1]],
};
const poRaw = (w, max) => 255 * Math.sqrt(w / max); // Yaesu PO scales are compressed toward the top
function poScale() {
  const k = s.pwrHead === 2 ? 10 : 1;
  const ticks = [0, 1, 5, 10, 15].map((w) => [String(w * k), poRaw(w, 15)]);
  [0.5, 2, 3, 4, 7.5, 12.5].forEach((w) => ticks.push(['', poRaw(w, 15), 1]));
  return { name: 'PO', unit: 'W', ticks };
}
const TX_SCALES = {
  4: { name: 'ALC', band: [[0, 85], [96, 150]], ticks: [['', 0, 1], ['', 255, 1]] },
  6: { name: 'SWR', hot: 126, ticks: [['1', 0], ['1.5', 52], ['2', 89], ['3', 126], ['∞', 255], ['', 26, 1], ['', 70, 1]] },
  3: { name: 'COMP', unit: 'dB', ticks: [['0', 0], ['5', 64], ['10', 128], ['15', 192], ['20', 255], ['', 32, 1], ['', 96, 1], ['', 160, 1], ['', 224, 1]] },
  7: { name: 'ID', ticks: [['0', 0], ['25', 64], ['50', 128], ['75', 192], ['100', 255]], unit: '%' },
  8: { name: 'VDD', ticks: [['0', 0], ['5', 64], ['10', 128], ['15', 192], ['20', 255]], unit: 'V' },
};
function drawMeters() {
  const bottom = cfg.meterSel === 5 ? poScale() : TX_SCALES[cfg.meterSel];
  for (let v = 0; v < 2; v++) {
    const m = meters[v];
    const txBand = s.tx && s.ft === v;
    // while transmitting, the meter on the opposite side turns gray
    // both sides show the S scale and the selected TX meter (manual p.17)
    m.configure({ top: S_SCALE, bottom, reading: txBand ? 'bottom' : 'top', dimmed: s.tx && !txBand });
    const rxOn = v === 0 || s.dual || s.vs === 1;
    m.set(txBand ? s.meters[cfg.meterSel] : s.tx || !rxOn ? 0 : s.smeter[v]);
    m.setVol(s.af[v] / 255);
  }
}

// ---------------- filter function display ----------------
function drawFilters() {
  for (let v = 0; v < 2; v++) {
    const mode = s.mode[v];
    const w = widthHz(mode, s.width[v]);
    const sh = s.shiftOn[v] ? s.shift[v] : 0;
    let span, lo, hi;
    if (isCW(mode)) {
      const pitch = 300 + s.kp * 10;
      span = 2 * pitch;
      lo = pitch - w / 2 + sh; hi = pitch + w / 2 + sh;
    } else if (isFM(mode) || mode === '5' || mode === 'D') {
      span = 8000; lo = 4000 - w / 3; hi = 4000 + w / 3;
    } else {
      span = 4000; lo = 200 + sh; hi = 200 + w + sh;
    }
    filters[v].set({
      lo: clamp(lo, 0, span), hi: clamp(hi, 0, span), span,
      notch: s.notch[v] ? s.notchHz[v] : null,
      contour: s.contour[v] ? s.contourHz[v] : null,
    });
  }
}

// ---------------- knobs & dials ----------------
const afKnobs = [];
function knobMode(v) { return ui.knMode[v] === 'af' ? 'af' : isFM(s.mode[v]) || s.mode[v] === '5' || s.mode[v] === 'D' ? 'sql' : 'rf'; }
function setupKnobs() {
  for (let v = 0; v < 2; v++) {
    const k = new Knob($(`#knAF${v}`), {
      onTurn: (n) => {
        const kind = knobMode(v);
        const cur = kind === 'af' ? s.af[v] : kind === 'rf' ? s.rf[v] : s.sql[v];
        const nv = clamp(cur + n * 4, 0, 255);
        if (kind === 'af') radio.setAF(v, nv); else if (kind === 'rf') radio.setRF(v, nv); else radio.setSQL(v, nv);
        popup(`${kind.toUpperCase()} ${kind === 'af' ? 'GAIN ' : kind === 'rf' ? 'GAIN ' : ''}${side(v)}`, pct255(nv), nv / 255);
      },
      // press switches the knob between AF and RF (SSB/CW/DATA) or SQL (AM/FM)
      onPress: () => { ui.knMode[v] = ui.knMode[v] === 'af' ? 'alt' : 'af'; render(); },
    });
    afKnobs.push({ k, v });
  }

  const func = new Knob($('#knFunc'), {
    pxPerStep: 6,
    onTurn: (n) => {
      // a radio-only function (D-LEVEL ...) has no CAT command to adjust; say so instead of turning something else
      if (radio.connected && ui.funcRadioOnly) { popup(SF_NAME[s.sf], '本体で操作', 0); func.showFree(); return; }
      adjust(cfg.func, n); func.showFree();
    },
    onPress: () => openPop('FUNCTION'),
  });

  const sub = new Knob($('#knSubDial'), {
    pxPerStep: 3,
    onTurn: (n) => { tune(n, 1); sub.showFree(); },
    onPress: () => radio.swap(),
  });

  ui.dial = new Dial($('#dial'), { stepsPerRev: +cfg.dialRes, onStep: (n) => tune(n, 0) });
}

// default dial steps per mode (FTX-1 manual p.11): normal / [FINE] / (FAST)
function modeStep(mode) {
  if (['1', '2', '3', '7'].includes(mode)) return 20;
  if (isFM(mode) || mode === '5' || mode === 'D') return 100;
  return 10;
}
function curStep(v = 0) {
  const base = cfg.step === 'auto' ? modeStep(s.mode[v]) : cfg.step;
  if (ui.fine) return isFM(s.mode[v]) || s.mode[v] === '5' || s.mode[v] === 'D' ? 10 : 1;
  if (ui.fast) return base * 10;
  return base;
}
function tune(n, v) {
  if (s.lock) { popup('LOCK', 'DIAL LOCK', 0); ui.dial.stop(); return; }
  // with CLAR active the dial moves the clarifier offset instead of the frequency
  if (v === 0 && (s.clarRx[0] || s.clarTx[0])) {
    radio.setClarOffset(0, s.clarOfs[0] + n * 10);
    popup('CLAR', signed(s.clarOfs[0], 'Hz'), (s.clarOfs[0] + 9999) / 19998);
    return;
  }
  const step = curStep(v);
  radio.setFreq(v, Math.round(s.freq[v] / step) * step + n * step);
}

// ---------------- PTT ----------------
async function setPtt(on) {
  if (on === ui.ptt) return;
  if (on && !radio.connected) { toast('CATが接続されていません', true); return; }
  ui.ptt = on;
  audio.setTxOpen(!cfg.txGate || on);
  clearTimeout(ui.totTimer);
  if (on && +cfg.tot > 0) {
    ui.totTimer = setTimeout(() => { setPtt(false); toast('TOT: 送信タイマーにより送信を停止しました', true); }, cfg.tot * 1000);
  }
  const m = cfg.pttMethod;
  if (m.startsWith('cat')) {
    radio.ptt(on, m === 'cat2' ? 2 : 1);
  } else {
    const link = ui.pttLink?.isOpen ? ui.pttLink : radio.link;
    try {
      await link.setSignals(m === 'rts' ? { requestToSend: on } : { dataTerminalReady: on });
      s.tx = on;
    } catch (e) {
      toast(`PTT信号の設定に失敗: ${e.message}`, true);
    }
  }
  render();
}

function setupPtt() {
  const btn = $('#btnPtt');
  const latch = $('#pttLatch');
  latch.checked = cfg.latch;
  latch.addEventListener('change', () => { cfg.latch = latch.checked; save(); });
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (cfg.latch) { setPtt(!ui.ptt); return; }
    btn.setPointerCapture(e.pointerId);
    setPtt(true);
  });
  const up = () => { if (!cfg.latch) setPtt(false); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  // never leave the transmitter keyed when the window loses focus
  window.addEventListener('blur', () => setPtt(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPtt(false); });
  window.addEventListener('pagehide', () => setPtt(false));
}

// ---------------- hard keys ----------------
// value: fn, or { press, hold } for keys whose long press does something else (as on the radio)
const ACTIONS = {
  // QMB (quick memory bank, kept locally): press recalls the next slot, hold stores MAIN
  qmb: {
    press: () => {
      if (radio.connected) { radio.qmbRecall(); popup('QMB', 'RECALL', 1); return; }
      if (!cfg.qmb.length) { popup('QMB', 'EMPTY', 0); return; }
      ui.qmbIdx = ((ui.qmbIdx ?? -1) + 1) % cfg.qmb.length;
      const q = cfg.qmb[ui.qmbIdx];
      radio.setFreq(0, q.f);
      radio.setMode(0, q.m);
      popup(`QMB ${ui.qmbIdx + 1}`, (q.f / 1e6).toFixed(3), (ui.qmbIdx + 1) / cfg.qmb.length);
    },
    hold: () => {
      if (radio.connected) { radio.qmbStore(); popup('QMB STORE', (s.freq[0] / 1e6).toFixed(3), 1); return; }
      cfg.qmb = [{ f: s.freq[0], m: s.mode[0] }, ...cfg.qmb].slice(0, 5);
      ui.qmbIdx = -1;
      save();
      popup('QMB STORE', (s.freq[0] / 1e6).toFixed(3), cfg.qmb.length / 5);
    },
  },
  band: { press: () => bandStep(true), hold: () => openPop('BAND') },
  nw: { press: () => radio.setNarrow(V(), !s.nar[V()]), hold: () => openPop('MODE') },
  // ◢ key: press swaps MAIN/SUB (SV), hold toggles SPLIT (manual: SPLIT is the long press)
  split: { press: () => radio.swap(), hold: toggleSplit },
  vm: { press: () => radio.vmKey(), hold: () => { radio.memWrite(); popup('MW', 'MEMORY WRITE', 1); } },
  mv: { press: () => radio.memToVfo(), hold: () => { radio.memTune(0); popup('MT', 'MEMORY TUNE', 1); } },
  // no CAT command exists for these
  gm: () => toast('GM は CAT では操作できません'),
  sdx: () => toast('S-DX は CAT では操作できません'),
  pmg: () => toast('PMG は CAT では操作できません'),
  swap: () => radio.swap(),
  aToB: () => radio.copyAtoB(),
  clar: {
    // OFF → CLAR RX → CLAR TX → CLAR RXTX → OFF ; hold clears the offset
    press: () => {
      const v = 0, r = s.clarRx[v], t = s.clarTx[v];
      const next = !r && !t ? [1, 0] : r && !t ? [0, 1] : !r && t ? [1, 1] : [0, 0];
      radio.setClar(v, !!next[0], !!next[1]);
    },
    hold: () => { radio.setClarOffset(0, 0); popup('CLAR', '0Hz', 0.5); },
  },
  disp: () => {
    cfg.layout = LAYOUTS[(LAYOUTS.indexOf(cfg.layout) + 1) % LAYOUTS.length];
    save();
  },
  back: { press: () => { closePop(); $('#popup').hidden = true; }, hold: () => {} },
  // FINE / FAST follow the radio (FN) while connected
  fine: {
    press: () => { if (radio.connected) radio.setFine(s.fn === 1 ? 0 : 1); else { ui.fine = !ui.fine; ui.fast = false; } },
    hold: () => { if (radio.connected) radio.setFine(s.fn === 2 ? 0 : 2); else { ui.fast = !ui.fast; ui.fine = false; } },
  },
  step: () => {
    cfg.step = STEPS[(STEPS.indexOf(cfg.step) + 1) % STEPS.length];
    save();
    popup('DIAL STEP', cfg.step === 'auto' ? `AUTO (${stepText(modeStep(s.mode[0]))})` : stepText(cfg.step), STEPS.indexOf(cfg.step) / (STEPS.length - 1));
  },
  entry: () => openEntry(V()),
};
const stepText = (st) => (st >= 1000 ? `${st / 1000}kHz` : `${st}Hz`);

function setupKeys() {
  $$('[data-act]').forEach((el) => {
    const a = ACTIONS[el.dataset.act];
    if (!a) return;
    if (typeof a === 'function') { el.addEventListener('click', () => { a(); render(); }); return; }
    let timer = null, held = false;
    el.addEventListener('pointerdown', () => {
      held = false;
      timer = setTimeout(() => { held = true; a.hold(); render(); }, 600);
    });
    const cancel = () => clearTimeout(timer);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', () => { cancel(); if (!held) { a.press(); render(); } });
  });
}

// ---------------- keyboard ----------------
function setupKeyboard() {
  const typing = (e) => e.target.closest('input, textarea, select, dialog') || $('#entryDlg').open;
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (cfg.latch) setPtt(!ui.ptt); else setPtt(true);
      return;
    }
    if (e.target.closest('.knob')) return;
    const mul = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); tune(mul, 0); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); tune(-mul, 0); }
    if (e.key === 'PageUp') { e.preventDefault(); bandStep(true, 0); }
    if (e.key === 'PageDown') { e.preventDefault(); bandStep(false, 0); }
    if (e.key === 'Escape') closePop();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !cfg.latch && !typing(e)) setPtt(false);
  });
}

// ---------------- connection ----------------
async function toggleConnect() {
  if (!('serial' in navigator)) { toast('Web Serial 非対応のブラウザです', true); return; }
  if (radio.connected) { await setPtt(false); await radio.disconnect(); return; }
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch { return; } // picker cancelled
  try {
    $('#btnConnect').classList.add('busy');
    const baud = await radio.connect(port, cfg.catBaud);
    if (!audio.rx) startRxAudio({ quiet: true });
    // ID answer: 0800 per the CAT manual (some firmware/Hamlib report 0840)
    const notFtx1 = s.id && !['0800', '0840'].includes(s.id);
    toast(`CAT接続しました（${baud}bps${notFtx1 ? ` / ID ${s.id}: FTX-1ではない可能性` : ''}）`, notFtx1);
  } catch (e) {
    if (e.code === 'NO_REPLY') {
      toast(cfg.catBaud === 'auto'
        ? 'このポートはCATに応答しません。FTX-1のもう一方のシリアルポートを選んでください'
        : `${cfg.catBaud}bpsで応答がありません。ボーレートを「自動」にするか、もう一方のポートを選んでください`, true);
    } else {
      toast(`ポートを開けません: ${e.message}（他のアプリが使用中の可能性）`, true);
    }
  } finally {
    $('#btnConnect').classList.remove('busy');
  }
}
radio.addEventListener('connection', () => {
  logLine('sys', radio.connected ? `connected @ ${radio.baud}bps` : 'disconnected');
  if (!radio.connected) { ui.ptt = false; clearTimeout(ui.totTimer); audio.setTxOpen(!cfg.txGate); }
  render();
});

async function togglePttPort() {
  if (ui.pttLink?.isOpen) {
    await ui.pttLink.close();
    ui.pttLink = null;
    $('#pttPortState').textContent = '未接続（CATポートを使用）';
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    const link = new SerialLink();
    await link.open(port, 38400, { framed: false });
    await link.setSignals({ requestToSend: false, dataTerminalReady: false });
    link.addEventListener('close', () => { $('#pttPortState').textContent = '切断'; });
    ui.pttLink = link;
    $('#pttPortState').textContent = 'PTTポート接続中（RTS/DTR用）';
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(`PTTポートを開けません: ${e.message}`, true);
  }
}

// ---------------- console ----------------
const logEl = $('#log');
function logLine(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  const t = new Date();
  d.innerHTML = `<span class="t">${t.toTimeString().slice(0, 8)}</span>`;
  d.append(`${cls === 'tx' ? '→ ' : cls === 'rx' ? '← ' : ''}${text}`);
  const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
  logEl.appendChild(d);
  while (logEl.childElementCount > 400) logEl.firstChild.remove();
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}
radio.addEventListener('log', (e) => {
  const { dir, text, poll } = e.detail;
  if (poll && !cfg.showPoll) return;
  logLine(dir, text);
});
function setupConsole() {
  const send = () => {
    const v = $('#rawCmd').value;
    if (!radio.connected) { toast('CATが接続されていません', true); return; }
    v.split(';').map((c) => c.trim()).filter(Boolean).forEach((c) => radio.raw(c));
    $('#rawCmd').value = '';
  };
  $('#btnRaw').addEventListener('click', send);
  $('#rawCmd').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  $('#showPoll').checked = cfg.showPoll;
  $('#showPoll').addEventListener('change', (e) => { cfg.showPoll = e.target.checked; save(); });
  $('#btnClearLog').addEventListener('click', () => { logEl.innerHTML = ''; });
}

// ---------------- CW ----------------
function setupCw() {
  const send = async (text) => {
    if (!radio.connected) { toast('CATが接続されていません', true); return; }
    if (!text.trim()) return;
    if (!isCW(s.mode[s.ft])) toast('CWモードではありません（送信されない場合があります）');
    ui.cwAbort?.abort();
    const ac = new AbortController();
    ui.cwAbort = ac;
    $('#btnCwSend').classList.add('on');
    await radio.sendCW(text, ac.signal);
    if (ui.cwAbort === ac) { ui.cwAbort = null; $('#btnCwSend').classList.remove('on'); }
  };
  $('#btnCwSend').addEventListener('click', () => send($('#cwText').value));
  $('#btnCwStop').addEventListener('click', () => {
    ui.cwAbort?.abort();
    ui.cwAbort = null;
    $('#btnCwSend').classList.remove('on');
    radio.stopCW();
  });
  const mem = $('#cwMem'); // shares the key row with SEND / STOP
  cfg.cwMem.forEach((txt, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `M${i + 1}`;
    const upd = () => { b.classList.toggle('has', !!cfg.cwMem[i]); b.title = cfg.cwMem[i] || '(空)'; };
    upd();
    b.addEventListener('click', (e) => {
      if (e.shiftKey) {
        cfg.cwMem[i] = $('#cwText').value.toUpperCase();
        save();
        upd();
        toast(`M${i + 1} に登録しました`);
      } else if (cfg.cwMem[i]) send(cfg.cwMem[i]);
    });
    mem.appendChild(b);
  });
}

// ---------------- audio ----------------
// explicit user choice (saved) wins; otherwise re-pick every time, since labels only appear after permission
function fillSelect(sel, list, saved, pick) {
  sel.innerHTML = '';
  for (const d of list) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || (d.deviceId === 'default' ? '既定のデバイス' : `デバイス ${d.deviceId.slice(0, 6)}`);
    sel.appendChild(o);
  }
  if (saved && list.some((d) => d.deviceId === saved)) sel.value = saved;
  else { const p = pick(list); if (p) sel.value = p.deviceId; }
}
async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const { inputs, outputs } = await audio.devices();
  const radioDev = (l) => l.find(isRadioDevice);
  const pcDev = (l) => l.find((d) => d.deviceId === 'default') || l.find((d) => !isRadioDevice(d));
  fillSelect($('#rxIn'), inputs, cfg.rxIn, radioDev);
  fillSelect($('#rxOut'), outputs, cfg.rxOut, pcDev);
  fillSelect($('#txIn'), inputs, cfg.txIn, pcDev);
  fillSelect($('#txOut'), outputs, cfg.txOut, radioDev);
}
async function startRxAudio({ quiet = false } = {}) {
  try {
    const opts = [...$('#rxIn').options];
    if (!opts.length || opts.some((o) => /^(デバイス|既定)/.test(o.textContent))) {
      // device labels stay hidden until mic permission is granted
      await audio.unlockLabels();
      await refreshDevices();
    }
    const sel = $('#rxIn').selectedOptions[0];
    if (sel && !isRadioDevice({ label: sel.textContent }) && !cfg.rxIn) toast('FTX-1のオーディオデバイスが見つかりません。RX入力を選択してください', true);
    await audio.startRx({ inputId: $('#rxIn').value, outputId: $('#rxOut').value, volume: +cfg.rxVol });
  } catch (e) {
    if (!quiet) toast(`RXオーディオ開始失敗: ${e.message}`, true);
  }
}
function setupAudio() {
  $('#rxVol').value = cfg.rxVol;
  $('#txGain').value = cfg.txGain;
  $('#txGate').checked = cfg.txGate;
  ['rxIn', 'rxOut', 'txIn', 'txOut'].forEach((id) => $(`#${id}`).addEventListener('change', (e) => { cfg[id] = e.target.value; save(); }));

  $('#btnRx').addEventListener('click', () => (audio.rx ? audio.stopRx() : startRxAudio()));
  $('#scope').addEventListener('click', () => { if (!audio.rx) startRxAudio(); });
  $('#btnMute').addEventListener('click', () => {
    if (!audio.rx) return;
    audio.setRxMute(!audio.rx.muted);
    audio.dispatchEvent(new Event('state'));
  });
  $('#rxVol').addEventListener('input', (e) => { cfg.rxVol = +e.target.value; audio.setRxVolume(cfg.rxVol); save(); });
  $('#btnRec').addEventListener('click', () => { if (audio.recorder) audio.stopRecording(); else audio.startRecording(); });
  audio.addEventListener('recording', (e) => {
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    a.href = URL.createObjectURL(e.detail);
    a.download = `ftx1-rx-${ts}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  $('#btnTx').addEventListener('click', async () => {
    try {
      if (audio.tx) { await audio.stopTx(); return; }
      await audio.unlockLabels();
      await refreshDevices();
      await audio.startTx({ micId: $('#txIn').value, outputId: $('#txOut').value, gain: +cfg.txGain });
      audio.setTxOpen(!cfg.txGate || ui.ptt);
    } catch (e) { toast(`TXオーディオ開始失敗: ${e.message}`, true); }
  });
  $('#txGain').addEventListener('input', (e) => { cfg.txGain = +e.target.value; audio.setTxGain(cfg.txGain); save(); });
  $('#txGate').addEventListener('change', (e) => { cfg.txGate = e.target.checked; audio.setTxOpen(!cfg.txGate || ui.ptt); save(); });
  $('#txTone').addEventListener('change', (e) => audio.setTone(e.target.checked));

  audio.addEventListener('state', () => {
    $('#btnRx').textContent = audio.rx ? 'RX停止' : 'RX開始';
    $('#btnRx').classList.toggle('on', !!audio.rx);
    $('#btnMute').classList.toggle('on', !!audio.rx?.muted);
    $('#btnRec').disabled = !audio.rx;
    $('#btnRec').classList.toggle('on', !!audio.recorder);
    $('#btnRec').textContent = audio.recorder ? '■ STOP' : '● REC';
    $('#btnTx').textContent = audio.tx ? 'TX音声 OFF' : 'TX音声 ON';
    $('#btnTx').classList.toggle('on', !!audio.tx);
    if (!audio.tx) $('#txTone').checked = false;
    scope.setSource(audio.rxAnalyser, audio.rxSampleRate);
    filters.forEach((f) => f.setSource(audio.rxAnalyser, audio.rxSampleRate));
  });
  audio.addEventListener('devicechange', () => refreshDevices());
  refreshDevices();

  const vu = (el, lv) => {
    const db = lv ? 20 * Math.log10(lv.rms + 1e-9) : -90;
    el.style.width = `${clamp((db + 60) / 60, 0, 1) * 100}%`;
    el.style.setProperty('--w', `${el.parentElement.clientWidth}px`);
  };
  const loop = () => {
    vu($('#rxVu'), audio.rxLevel());
    vu($('#txVu'), audio.txLevel());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------------- settings panel ----------------
function setupSettings() {
  const bindSel = (id, key, after) => {
    const el = $(`#${id}`);
    el.value = String(cfg[key]);
    el.addEventListener('change', () => {
      cfg[key] = /^\d+$/.test(el.value) ? +el.value : el.value;
      save();
      after?.();
    });
  };
  bindSel('baud', 'catBaud', () => { if (radio.connected) toast('ボーレートは再接続後に反映されます'); });
  bindSel('pttMethod', 'pttMethod');
  bindSel('dialRes', 'dialRes', () => { ui.dial.stepsPerRev = +cfg.dialRes; });
  bindSel('tot', 'tot');
  bindSel('scopeSpan', 'scopeSpan', () => { scope.span = +cfg.scopeSpan; });
  scope.span = +cfg.scopeSpan;
  const con = $('#showConsole');
  con.checked = cfg.console;
  $('#panelConsole').hidden = !cfg.console;
  con.addEventListener('change', () => { cfg.console = con.checked; $('#panelConsole').hidden = !cfg.console; save(); });
  $('#btnRadioBaud').addEventListener('click', async () => {
    const rate = +$('#radioBaud').value;
    if (!radio.connected) { toast('CATが接続されていません', true); return; }
    if (!confirm(`本体の CAT-1 / CAT-2 ボーレートを ${rate}bps に変更して再接続します。よろしいですか？`)) return;
    try {
      await radio.setRadioBaud(rate);
      cfg.catBaud = rate;
      $('#baud').value = String(rate);
      save();
      toast(`本体の CAT-1 / CAT-2 を ${rate}bps にしました`);
    } catch (e) {
      toast(`変更後の再接続に失敗しました: ${e.message}（POWER で接続し直してください）`, true);
    }
  });
  $('#btnPttPort').addEventListener('click', togglePttPort);
  $('#btnConnect').addEventListener('click', toggleConnect);
}

// ---------------- CW decoder (on RX audio) ----------------
function setupDecoder() {
  const dec = new CwDecoder();
  dec.channel = cfg.decCh;
  const textEl = $('#decText');
  // follow RX audio: the decoder lives in the RX AudioContext, so re-attach whenever RX restarts
  let pending = null;
  const sync = async () => {
    const rx = audio.rx;
    if (!cfg.dec || !rx) { pending = null; dec.stop(); return; }
    if (dec.ctx === rx.ctx || pending === rx.ctx) return;
    pending = rx.ctx;
    try {
      await dec.start(rx.ctx, rx.src);
      dec.setGain(cfg.decGain);
    } catch (e) { toast(`CWデコーダ開始失敗: ${e.message}`, true); }
    if (pending === rx.ctx) pending = null;
  };
  audio.addEventListener('state', sync);
  dec.addEventListener('text', () => {
    const atBottom = textEl.scrollHeight - textEl.scrollTop - textEl.clientHeight < 30;
    textEl.textContent = dec.text;
    if (atBottom) textEl.scrollTop = textEl.scrollHeight;
  });

  $('#btnDec').addEventListener('click', () => {
    cfg.dec = !cfg.dec;
    save();
    $('#btnDec').classList.toggle('on', cfg.dec);
    if (cfg.dec && !audio.rx) startRxAudio();
    sync();
  });
  $('#btnDecMode').addEventListener('click', () => dec.toggleMode());
  $('#btnDecTone').addEventListener('click', () => dec.cycleTone());
  $('#btnDecClr').addEventListener('click', () => dec.clear());
  $('#decCh').value = cfg.decCh;
  $('#decCh').addEventListener('change', (e) => { cfg.decCh = e.target.value; dec.setChannel(cfg.decCh); save(); });
  const gainLabel = () => { $('#decGainV').textContent = `${cfg.decGain > 0 ? '+' : ''}${cfg.decGain} dB`; };
  $('#decGain').value = cfg.decGain;
  gainLabel();
  $('#decGain').addEventListener('input', (e) => { cfg.decGain = +e.target.value; dec.setGain(cfg.decGain); gainLabel(); save(); });

  // status labels change at frame rate; only touch the DOM when they differ
  let last = '';
  setInterval(() => {
    const key = [dec.active, dec.jp, dec.toneAuto, dec.toneHz, dec.wpm, dec.gate].join();
    if (key === last) return;
    last = key;
    $('#btnDecMode').textContent = dec.jp ? 'JP' : 'US';
    $('#btnDecTone').textContent = dec.toneAuto || !dec.toneHz ? 'AUTO' : `${dec.toneHz}Hz`;
    $('#decInfo').textContent = dec.active ? `${dec.wpm || '--'} WPM · ${dec.toneHz || '---'}Hz` : 'OFF';
    $('#decLed').classList.toggle('on', dec.active && dec.gate);
  }, 100);
  $('#btnDec').classList.toggle('on', cfg.dec);
}

// ---------------- right sidebar (USB AUDIO / SETUP) ----------------
function setupSidebar() {
  $('#appVer').textContent = `v${APP_VERSION}`;
  $('#sbVer').textContent = `v${APP_VERSION}`;
  // the last rejected command, shown next to the error count
  // every rejection since connecting, shown together (the newest one used to overwrite the earlier ones)
  ui.errs = [];
  radio.addEventListener('connection', () => { if (radio.connected) ui.errs = []; });
  radio.addEventListener('log', (e) => {
    if (e.detail.dir !== 'err' || !e.detail.text.startsWith('?')) return;
    ui.errs = [...ui.errs, e.detail.text.replace(/^\? \(rejected: (.*)\)$/, '$1')].slice(-6);
  });
  $('#sbErr').addEventListener('click', () => {
    cfg.console = true;
    save();
    $('#showConsole').checked = true;
    $('#panelConsole').hidden = false;
    $('#panelConsole').scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
  const app = $('#app');
  const narrow = matchMedia('(max-width: 900px)');
  app.classList.toggle('nomenu', !cfg.sidebar);
  $('#btnMenu').addEventListener('click', () => {
    // narrow screens: overlay that starts closed; wide screens: docked column, state is remembered
    if (narrow.matches) { app.classList.toggle('menu-open'); return; }
    cfg.sidebar = !cfg.sidebar;
    app.classList.toggle('nomenu', !cfg.sidebar);
    save();
  });
  document.querySelectorAll('#sidebar details').forEach((d) => {
    if (d.id in cfg.sections) d.open = cfg.sections[d.id];
    d.addEventListener('toggle', () => { cfg.sections[d.id] = d.open; save(); });
  });
}

// ---------------- render ----------------
let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; draw(); });
}

function statusHtml() {
  const swrHigh = s.tx && s.meters[6] > 126;
  const items = [
    s.lock && ['LOCK', ''],
    (swrHigh || s.ri?.hiswr) && ['HI-SWR', 'warn'],
    ui.fine && ['FINE', 'inv'],
    ui.fast && ['FAST', 'inv'],
    s.vox && ['VOX', ''],
    s.tuner && ['TUNE', s.ri?.tuning ? 'blink' : ''],
    s.bkin && ['BK-IN', ''],
    isSplit() && ['SPLIT', ''],
  ].filter(Boolean);
  // radio indicators only; the app's own state (CAT link, errors, clock) is in the window status bar
  return items.map(([t, c]) => `<span class="si ${c}">${t}</span>`).join('') + '<span class="sp"></span>';
}

// window status bar: CAT link / USB audio / CAT errors / clock / version
// (text is only written when it changes, so a selection in the bar survives and can be copied)
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
function drawStatusbar() {
  const conn = radio.connected;
  const cat = $('#sbCat');
  cat.classList.toggle('on', conn);
  setText(cat.lastChild, conn ? `${radio.baud}bps${s.ai ? ' · AI' : ''}${s.id ? ` · ID ${s.id}` : ''}` : '未接続');
  const au = $('#sbAudio');
  au.classList.toggle('on', !!audio.rx);
  setText(au.lastChild, audio.rx ? `RX${audio.rx.muted ? ' (MUTE)' : ''}${audio.tx ? ' · TX' : ''}` : (audio.tx ? 'TX' : '停止'));
  const err = $('#sbErr');
  err.hidden = !s.errors;
  setText(err, `CAT ERR ${s.errors}`);
  setText($('#sbMsg'), s.errors && ui.errs?.length ? `拒否されたコマンド: ${ui.errs.join(' ')}` : '');
  const d = new Date();
  setText($('#sbClock'), `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
}

function draw() {
  const conn = radio.connected;
  $('#btnConnect').classList.toggle('on', conn);
  const lcd = $('#lcd');
  const lcdCls = `lcd lay-${cfg.layout}${cfg.layout === 'single' && s.vs === 1 ? ' only-sub' : ''}${conn ? '' : ' off'}`;
  if (lcd.className !== lcdCls) { lcd.className = lcdCls; requestAnimationFrame(fitFreq); }

  const st = statusHtml();
  if ($('#stBar').innerHTML !== st) $('#stBar').innerHTML = st;
  drawStatusbar();

  for (let v = 0; v < 2; v++) {
    const band = $(`#band${v}`);
    band.classList.toggle('sel', s.vs === v);
    band.querySelector('.b-mode').textContent = MODE_NAME[s.mode[v]] || '---';
    // VFO / memory channel tag (IF/OI P7, P1)
    const vm = s.vm[v], chn = /^\d+$/.test(vm.ch) ? `M-${String(+vm.ch).padStart(3, '0')}` : vm.ch;
    setText(band.querySelector('.tg-vfo'), !conn ? 'VFO' : vm.t === 1 ? chn : vm.t === 2 ? 'MT' : vm.t === 3 ? 'QMB' : vm.t === 5 ? `PMS ${vm.ch}` : 'VFO');
    const html = freqHtml(s.freq[v]);
    if (html !== lastFreqHtml[v]) { $(`#freq${v}`).innerHTML = html; lastFreqHtml[v] = html; fitFreq(); }
    // the transmitting side's frequency turns red, as on the radio
    $(`#freq${v}`).classList.toggle('tx', (s.tx || ui.ptt) && s.ft === v);
    const tr = $(`#txrx${v}`);
    const rxOn = v === s.vs || s.dual;
    tr.textContent = s.ft === v ? (s.tx ? 'TX' : 'TXRX') : 'RX';
    tr.className = `b-txrx${s.tx && s.ft === v ? ' tx' : s.ft === v ? '' : rxOn ? ' rx' : ' off'}`;
    for (const { t, el, b, span } of rxTileEls[v]) {
      b.textContent = t.label(v);
      span.textContent = t.value(v);
      el.classList.toggle('na', !!t.na?.(v)); // item names are yellow; white where the item does not apply
    }
  }
  $('#funcBox').textContent = funcName();

  drawMeters();
  drawFilters();
  updatePop();
  for (const sk of softKeys) {
    sk.b.textContent = val(sk.k.name);
    sk.span.textContent = sk.k.key();
    sk.el.classList.toggle('open', !!sk.k.pop && ui.pop === sk.k.pop);
  }
  $('#scope').style.visibility = cfg.afFft ? '' : 'hidden';

  for (const { k, v } of afKnobs) {
    const kind = knobMode(v);
    if (!k.active) k.setFraction((kind === 'af' ? s.af[v] : kind === 'rf' ? s.rf[v] : s.sql[v]) / 255);
    $(`#knAF${v}mode`).textContent = kind.toUpperCase();
  }

  $('#keySplit').classList.toggle('on', isSplit());
  $('#keyFine').classList.toggle('on', ui.fine || ui.fast);
  $('#keyClar').classList.toggle('on', s.clarRx[0] || s.clarTx[0]);
  // VFO mode indicator arcs: blue = VFO, red = clarifier. BUSY/TX: red on TX, green with signal above squelch
  // VFO mode indicator (manual): blue = MAIN side, green = SUB side, red = clarifier or split
  const clarOn = s.clarRx[s.vs] || s.clarTx[s.vs];
  $('#vfoArc').className = `vfo-arc ${conn ? (clarOn || isSplit() ? 'red' : s.vs ? 'green' : 'blue') : ''}`;
  for (let v = 0; v < 2; v++) {
    // MAIN: squelch state from RI; SUB (no CAT read for it): estimated from the S meter
    const busy = conn && !s.tx && (v === 0 ? (s.ri ? s.ri.busy : s.smeter[0] > Math.max(12, s.sql[0] / 2)) : s.dual && s.smeter[1] > Math.max(12, s.sql[1] / 2));
    $(`#ledBusy${v}`).className = s.tx && s.ft === v ? 'red' : busy ? 'green' : '';
  }

  $('#btnPtt').classList.toggle('on', s.tx || ui.ptt);
  // CW TX / RX panels only while the operated VFO is in CW
  const cw = isCW(s.mode[V()]);
  $('#panelCw').hidden = !cw;
  $('#panelDec').hidden = !cw;
  $('#cwWpm').textContent = `${s.ks} WPM`;
  $('#catErr').textContent = `ERR ${s.errors}`;
  $('#catErr').classList.toggle('err', s.errors > 0);
  // the radio's scope settings line (e.g. "CENTER FAST2 SPAN 100kHz")
  $('#scInfo').textContent = `${SC_DMODE[scopeDmode()]} ${SC_SPEED[+s.scope[0]] || ''} SPAN ${(SC_SPAN[s.scope[5]] || '').replace('k', 'kHz').replace('M', 'MHz')}`;
}

radio.addEventListener('change', () => {
  if (radio.connected) { ui.fine = s.fn === 1; ui.fast = s.fn === 2; }
  if (s.nb[V()] > 0) ui.lastNb = s.nb[V()];
  if (s.nr[V()] > 0) ui.lastNr = s.nr[V()];
  render();
});
setInterval(render, 250);

// ---------------- boot ----------------
if (!('serial' in navigator)) $('#unsupported').hidden = false;
installDigitGlyphs();
setupSoftbar();
setupBands();
setupEntry();
setupKnobs();
setupPtt();
setupKeys();
setupKeyboard();
setupConsole();
setupCw();
setupAudio();
setupSettings();
setupSidebar();
setupDecoder();
render();

// PWA install button: always shown unless running as the installed app. Chrome only hands the page an install
// prompt now and then (not after it was dismissed, not when already installed), so without one the button explains
// where Chrome's own install menu is.
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
$('#btnInstall').hidden = standalone();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; $('#btnInstall').hidden = true; toast('アプリとしてインストールしました'); });
$('#btnInstall').addEventListener('click', async () => {
  if (installEvt) {
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    installEvt = null;
    return;
  }
  toast('Chrome のメニュー（右上の ⋮）→「キャスト、保存、共有」→「ページをアプリとしてインストール」から入れてください。インストール済みの場合は chrome://apps から起動できます', false, 9000);
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {});
}

// debug handle for the DevTools console, e.g. ftx.s.smeter[0] = 160
window.ftx = { radio, s, audio, cfg };
