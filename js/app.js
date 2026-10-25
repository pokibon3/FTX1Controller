import {
  FTX1, MODES, MODE_NAME, BANDS, bandOf, bandType, AGC, PREAMP_HF,
  widthText, widthHz, widthMin, widthMax, sText, S_TICKS, isCW, isFM,
} from './ftx1.js';
import { FT991A } from './ft991a.js';
import { IS991, MODEL_NAME } from './model.js';
import { Meter991 } from './meter991.js';
import { EX_MENUS_991 } from './exmenu991.js';
import { EX_DEFAULTS_991 } from './exdefaults991.js';
import { SerialLink } from './serial.js';
import { AudioEngine, isRadioDevice } from './audio.js';
import { Knob, Dial, wheelNotch, wheelAccel } from './knob.js';
import { AfScope } from './scope.js';
import { FtxMeter } from './ftxmeter.js';
import { FilterDisplay } from './filterdisp.js';
import { APP_VERSION } from './version.js';
import { CwDecoder } from './cwdecoder.js';
import { CwView } from './cwview.js';
import { CwSender } from './cwsend.js';
import { Ft8Decoder, ft8Wave } from './ft8.js';
import { installDigitGlyphs } from './digits.js';
import { EX_MENUS } from './exmenu.js';
import { EX_DEFAULTS } from './exdefaults.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const val = (x) => (typeof x === 'function' ? x() : x);

// FT-991A: its own face (index.html template) replaces the FTX-1 field head before anything binds to the elements
if (IS991) {
  $('#radio').replaceWith($('#head991').content.cloneNode(true));
  document.title = 'FT-991A Controller';
}
const radio = IS991 ? new FT991A() : new FTX1();
const s = radio.s;
const audio = new AudioEngine();
const scope = new AfScope($('#scope'));
// the FT-991A screen has no filter display and one meter
const filters = IS991 ? [] : [new FilterDisplay($('#filt0')), new FilterDisplay($('#filt1'))];
const meters = IS991 ? [new Meter991($('#meter0'))] : [new FtxMeter($('#meter0')), new FtxMeter($('#meter1'))];

// ---------------- settings ----------------
const DEFAULTS = {
  model: 'ftx1', catBaud: 'auto', catBaud991: 'auto', step: 'auto', dialRes: 250, pttMethod: 'cat1', tot: 180,
  rxIn: '', rxOut: '', txIn: '', txOut: '', rxVol: 0.8, txGain: 1, txGate: true,
  showPoll: false, scopeSpan: 3000, func: 'af', meterSel: 5, layout: 'lr', layoutV2: true,
  cwMem: ['CQ CQ CQ DE ', '', '', '', ''], bandStack: {}, latch: false, qmb: [],
  sidebar: false, sections: {}, afFft: true, ft8: true, ft8Cq: false, ft8My: '', ft8Grid: '', ft8TxHz: 1500, ft8Lvl: 0.3, ft8Per: 0, ft8Auto: true, ft8Mode: 'FT8', pcSql: true, dec: true, decCh: 'L', decGain: 0, decNr: true, console: false,
};
const cfg = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ftx1.cfg') || '{}') }; } catch { return { ...DEFAULTS }; }
})();
if (!['auto', 1, 10, 20, 50, 100, 200, 500, 1000, 2500, 5000, 6250, 10000, 12500, 25000].includes(cfg.step)) cfg.step = 'auto';
if (![3, 4, 5, 6, 7, 8].includes(cfg.meterSel) || (IS991 && cfg.meterSel === 8)) cfg.meterSel = 5; // the FT-991A has no VDD meter
// CAT CONSOLE and the side panel always start closed (they open on demand: SETUP checkbox / ☰)
cfg.console = false;
cfg.sidebar = false;
// v1.6: the default screen became L/R (as on the radio); switch saved settings over once
if (!cfg.layoutV2) { cfg.layout = 'lr'; cfg.layoutV2 = true; }
function save() { try { localStorage.setItem('ftx1.cfg', JSON.stringify(cfg)); } catch {} }

const STEPS = ['auto', 1, 10, 50, 100, 500, 1000, 2500, 5000, 6250, 10000, 12500, 25000];
const LAYOUTS = ['lr', 'ud', 'single'];
const ui = {
  fine: false, fast: false, ptt: false, pttLink: null, totTimer: null,
  pop: null, target: null, knMode: ['af', 'af'],
};

// target VFO for screens/FUNC: the band whose mode box was touched, else the selected one
const V = () => ui.target ?? s.vs;
const side = (v = V()) => (IS991 ? (v ? 'VFO-B' : 'VFO-A') : v ? 'SUB' : 'MAIN');
// CAT rate setting, kept per radio (the FT-991A goes up to 38400 bps, the FTX-1 to 115200)
const CATBAUD = IS991 ? 'catBaud991' : 'catBaud';
// local band stack (used without CAT BS); kept per radio, as the band codes differ
const BSTACK = IS991 ? 'bandStack991' : 'bandStack';
cfg[BSTACK] ||= {};
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
  width: { name: () => `WIDTH ${side()}`, get: () => s.width[V()], set: (v) => radio.setWidth(V(), v), min: () => widthMin(s.mode[V()], s.nar[V()]), max: () => widthMax(s.mode[V()], s.nar[V()]), step: 1, fmt: (v) => widthText(s.mode[V()], v, s.nar[V()]) },
  shift: { name: () => `SHIFT ${side()}`, get: () => s.shift[V()], set: (v) => radio.setShift(V(), true, v), min: -1200, max: 1200, step: 20, fmt: (v) => signed(v, 'Hz') },
  nb: { name: () => `NB LEVEL ${side()}`, get: () => s.nb[V()], set: (v) => radio.setNB(V(), v), min: 0, max: 10, step: 1, fmt: (v) => (v ? String(v) : 'OFF') },
  nr: { name: () => `DNR LEVEL ${side()}`, get: () => s.nr[V()], set: (v) => radio.setNR(V(), v), min: 0, max: radio.nrMax ?? 10, step: 1, fmt: (v) => (v ? String(v) : 'OFF') },
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
  // FTX-1: a 00-33 code; FT-991A: milliseconds (VD / SD 0030-3000)
  voxDelay: IS991
    ? { name: 'VOX DELAY', get: () => s.voxDelay, set: (v) => radio.setVoxDelay(v), min: 30, max: 3000, step: 10, fmt: (v) => `${v}ms` }
    : { name: 'VOX DELAY', get: () => s.voxDelay, set: (v) => radio.setVoxDelay(v), min: 0, max: 33, step: 1, fmt: (v) => `${delayMs(v)}ms` },
  tone: { name: () => `TONE FREQ ${side()}`, get: () => s.tone[V()], set: (v) => radio.setTone(V(), v), min: 0, max: 49, step: 1, fmt: (v) => `${CTCSS[v].toFixed(1)}Hz` },
  dcs: { name: () => `DCS ${side()}`, get: () => s.dcs[V()], set: (v) => radio.setDcs(V(), v), min: 0, max: 103, step: 1, fmt: (v) => DCS[v] },
  bkDelay: IS991
    ? { name: 'BK-DELAY', get: () => s.bkDelay, set: (v) => radio.setBkDelay(v), min: 30, max: 3000, step: 10, fmt: (v) => `${v}ms` }
    : { name: 'BK-DELAY', get: () => s.bkDelay, set: (v) => radio.setBkDelay(v), min: 0, max: 33, step: 1, fmt: (v) => `${delayMs(v)}ms` },
  clar: {
    name: () => `CLAR ${side()}`, get: () => s.clarOfs[V()], min: -9999, max: 9999, step: 10, fmt: (v) => signed(v, 'Hz'),
    set: (v) => {
      radio.setClarOffset(V(), v);
      if (!s.clarRx[V()] && !s.clarTx[V()]) radio.setClar(V(), true, false);
    },
  },
  // FT-991A CH DIAL (manual p.41): MULTI tunes in channel steps; the value is the step, chosen per mode group
  ...(IS991 ? { chd: { name: 'CH DIAL', get: () => chdIdx(), set: (v) => setChdIdx(v), min: 0, max: () => chdSteps().length - 1, step: 1, fmt: (v) => `${chdSteps()[v]}kHz` } } : {}),
};
// CH DIAL steps (kHz) as the radio cycles them: AM; FM / C4FM / DATA-FM; CW / SSB / RTTY / DATA-LSB / DATA-USB
const CHD_STEPS = { am: [2.5, 5, 9, 10, 12.5, 25], fm: [5, 6.25, 10, 12.5, 15, 20, 25], ssb: [1, 2.5, 5] };
const chdGroup = () => (['5', 'D'].includes(s.mode[0]) ? 'am' : isFM(s.mode[0]) ? 'fm' : 'ssb');
const chdSteps = () => CHD_STEPS[chdGroup()];
const chdIdx = () => Math.min((cfg.chd991 || {})[chdGroup()] || 0, chdSteps().length - 1);
function setChdIdx(i) { cfg.chd991 = { ...cfg.chd991, [chdGroup()]: i }; save(); }

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
// FT-991A: the MULTI knob's functions as its screen names them (manual p.22), and the ones it can take
const MULTI_NAME = { power: 'RF-P', mic: 'MIC-G', nb: 'NB-L', shift: 'SHIFT', width: 'WIDTH', notch: 'NOTCH', contour: 'CONT', nr: 'DNR',
  proc: 'PROC', moni: 'MONI', ks: 'SPEED', apf: 'APF', kp: 'PITCH', sql: 'SQL', tone: 'TONE', dcs: 'DCS', clar: 'CLAR',
  voxGain: 'VOX-G', voxDelay: 'VOX-D', bkDelay: 'BK-D', chd: 'CH-D' };
if (IS991 && !MULTI_NAME[cfg.func]) cfg.func = 'power';
if (!PARAMS[cfg.func]) cfg.func = 'af'; // (FTX-1 after the FT-991A's CH DIAL, which it does not have; settings are shared)
const funcName = () => (IS991 ? MULTI_NAME[cfg.func]
  : radio.connected && ui.funcRadioOnly ? SF_NAME[s.sf] : val(PARAMS[cfg.func].name).replace(/ (MAIN|SUB)$/, ''));
function assignFunc(key) {
  cfg.func = key;
  ui.funcRadioOnly = false;
  if (!IS991 && SF_OF_PARAM[key] && radio.connected) { radio.setFuncKnob(SF_OF_PARAM[key]); ui.sfSeen = SF_OF_PARAM[key]; }
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
  if (!cur.gen) cfg[BSTACK][cur.code] = { f: s.freq[v], m: s.mode[v] };
  save();
  const local = () => {
    const st = cfg[BSTACK][b.code] || { f: b.def, m: b.mode };
    if (!st.f) return;
    radio.setFreq(v, st.f);
    if (st.m) radio.setMode(v, st.m);
  };
  if (!radio.connected) { local(); return; }
  radio.bandSelect(v, b.code);
  // firmware without BS support: fall back to the local band stack
  setTimeout(() => { if (bandOf(s.freq[v]).code !== b.code && !b.gen) local(); }, 800);
}
function bandStep(up, v = V()) {
  if (radio.connected) { radio.bandStep(v, up); return; }
  const ham = BANDS.filter((b) => b.ham);
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

const METERS = IS991 ? { 5: 'PO', 4: 'ALC', 6: 'SWR', 3: 'COMP', 7: 'ID' } : { 5: 'PO', 3: 'COMP', 4: 'ALC', 8: 'VDD', 7: 'ID', 6: 'SWR' };
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

const RPT = ['SIMPLEX', '+', '−', 'ARS'];
const SQL_TYPE = ['OFF', 'ENC', 'TSQ', 'DCS', 'PR FREQ', 'REV TONE'];
// FT-991A CT P2: 0 OFF 1 CTCSS ENC/DEC 2 CTCSS ENC 3 DCS ENC/DEC 4 DCS ENC
const SQL_TYPE_991 = ['OFF', 'TSQ', 'ENC', 'DCS', 'DCS ENC'];
const FM_STEP = ['5k', '6.25k', '10k', '12.5k', '20k', '25k'];
const CTCSS = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];
const DCS = ['023', '025', '026', '031', '032', '036', '043', '047', '051', '053', '054', '065', '071', '072', '073', '074', '114', '115', '116', '122', '125', '131', '132', '134', '143', '145', '152', '155', '156', '162', '165', '172', '174', '205', '212', '223', '225', '226', '243', '244', '245', '246', '251', '252', '255', '261', '263', '265', '266', '271', '274', '306', '311', '315', '325', '331', '332', '343', '346', '351', '356', '364', '365', '371', '411', '412', '413', '423', '431', '432', '445', '446', '452', '454', '455', '462', '464', '465', '466', '503', '506', '516', '523', '526', '532', '546', '565', '606', '612', '624', '627', '631', '632', '654', '662', '664', '703', '712', '723', '731', '732', '734', '743', '754'];

// FT-991A [F] key: the function menu over the screen (manual p.23, 43): six touch keys per page with BACK / FWD,
// label above and the setting below. Keys that pick a MULTI knob function (as on the radio) also switch on a tap.
const F991_PAGES = () => [
  [
    { label: 'NAR/WIDE', value: () => `${s.nar[0] ? 'N' : 'W'} ${widthText(s.mode[0], s.width[0], s.nar[0])}`, on: () => s.nar[0], act: () => radio.setNarrow(0, !s.nar[0]), func: 'width' },
    { label: 'NB', value: () => (s.nb[0] ? `ON ${s.nb[0]}` : 'OFF'), on: () => s.nb[0] > 0, act: () => radio.setNB(0, s.nb[0] ? 0 : (ui.lastNb || 5)), func: 'nb' },
    { label: 'IPO', value: () => PREAMP_HF[preampVal(0)], act: () => cyclePreamp(0) },
    { label: '5/10Hz', value: () => `${cfg.dial991 || 10}Hz`, act: () => { cfg.dial991 = (cfg.dial991 || 10) === 10 ? 5 : 10; save(); } },
    { label: 'ATT', value: () => onOff(s.att), on: () => s.att, act: () => radio.setAtt(!s.att) },
    { label: 'AGC', value: () => AGC[s.agc[0]], act: () => radio.setAGC(0, (s.agc[0] + 1) % 5) },
  ],
  [
    { label: 'DNR', value: () => (s.nr[0] ? `ON ${s.nr[0]}` : 'OFF'), on: () => s.nr[0] > 0, act: () => radio.setNR(0, s.nr[0] ? 0 : (ui.lastNr || 8)), func: 'nr' },
    { label: 'DNF', value: () => onOff(s.bc[0]), on: () => s.bc[0], act: () => radio.setBeatCancel(0, !s.bc[0]) },
    { label: 'NOTCH', value: () => (s.notch[0] ? `${s.notchHz[0]}Hz` : 'OFF'), on: () => s.notch[0], act: () => radio.setNotch(0, !s.notch[0]), func: 'notch' },
    { label: 'CONT', value: () => (s.contour[0] ? `${s.contourHz[0]}Hz` : 'OFF'), on: () => s.contour[0], act: () => radio.setContour(0, !s.contour[0]), func: 'contour' },
    { label: 'APF', value: () => (s.apf[0] ? signed(s.apfOfs[0], 'Hz') : 'OFF'), on: () => s.apf[0], act: () => radio.setAPF(0, !s.apf[0]), func: 'apf' },
    { label: 'MONI', value: () => (s.moniOn ? String(s.moni) : 'OFF'), on: () => s.moniOn, act: () => radio.setMonitorOn(!s.moniOn), func: 'moni' },
  ],
  [
    { label: 'WIDTH', value: () => widthText(s.mode[0], s.width[0], s.nar[0]), func: 'width' },
    { label: 'SHIFT', value: () => (s.shiftOn[0] ? signed(s.shift[0], 'Hz') : 'OFF'), on: () => s.shiftOn[0], act: () => radio.setShift(0, !s.shiftOn[0], s.shift[0]), func: 'shift' },
    { label: 'PROC', value: () => (s.procOn ? String(s.proc) : 'OFF'), on: () => s.procOn, act: () => radio.setProcOn(!s.procOn), func: 'proc' },
    { label: 'MIC-EQ', value: () => onOff(s.micEq), on: () => s.micEq, act: () => radio.setMicEq(!s.micEq) },
    { label: 'VOX', value: () => (s.vox ? String(s.voxGain) : 'OFF'), on: () => s.vox, act: () => radio.setVox(!s.vox), func: 'voxGain' },
    { label: 'MOX', value: () => onOff(s.mox), on: () => s.mox, act: () => radio.setMox(!s.mox) },
  ],
  [
    { label: 'KEYER', value: () => onOff(s.keyer), on: () => s.keyer, act: () => radio.setKeyer(!s.keyer) },
    { label: 'BK-IN', value: () => (s.bkin ? `${s.bkDelay}ms` : 'OFF'), on: () => s.bkin, act: () => radio.setBreakIn(!s.bkin), func: 'bkDelay' },
    { label: 'SPOT', value: () => onOff(s.spot), on: () => s.spot, act: () => radio.setSpot(!s.spot) },
    { label: 'ZIN', act: () => radio.zeroIn(0) },
    { label: 'SPEED', value: () => `${s.ks}wpm`, func: 'ks' },
    { label: 'PITCH', value: () => `${300 + s.kp * 10}Hz`, func: 'kp' },
  ],
  [
    { label: 'RPT', value: () => RPT[s.os[0]] || 'SIMPLEX', act: () => radio.setRptShift(0, (s.os[0] + 1) % 3) },
    { label: 'TONE/DCS', value: () => SQL_TYPE_991[s.ct[0]] || 'OFF', act: () => radio.setSqlType(0, (s.ct[0] + 1) % 5) },
    { label: 'TONE', value: () => `${CTCSS[s.tone[0]]?.toFixed(1)}Hz`, func: 'tone' },
    { label: 'DCS', value: () => DCS[s.dcs[0]], func: 'dcs' },
    { label: 'SQL', value: () => pct255(s.sql[0]), func: 'sql' },
    { label: 'SCAN', value: () => onOff(s.scan), on: () => s.scan, act: () => radio.setScan(!s.scan) },
  ],
  [
    { label: 'MESSAGE', act: () => openPop('MESSAGE') },
    { label: 'PLAY', act: () => openPop('PLAY') },
    { label: 'REC', act: () => openPop('RECORD') },
    { label: 'MCH', na: true },
    { label: 'CH DIAL', value: () => `${chdSteps()[chdIdx()]}kHz`, func: 'chd', act: () => { if (cfg.func === 'chd') setChdIdx((chdIdx() + 1) % chdSteps().length); } },
    { label: 'MENU', value: () => 'SETUP', act: () => { closePop(); openSettings(0); } },
  ],
];
function F991_SCREENS() {
  const pages = F991_PAGES(), n = pages.length;
  return Object.fromEntries(pages.map((keys, i) => [`F ${i + 1}/${n}`, {
    f991: true,
    items: () => [...keys.slice(0, 4),
      { label: 'BACK', nav: '◀', act: () => openPop(`F ${(i + n - 1) % n + 1}/${n}`) },
      ...keys.slice(4),
      { label: 'FWD', nav: '▶', act: () => openPop(`F ${(i + 1) % n + 1}/${n}`) }],
  }]));
}

const SCREENS = {
  // [FUNC] knob press: the radio's three function pages, laid out key for key as in the operation manual
  // (p.25, 31, 46, 54): 7 x 4 keys over the lower half of the screen, label above / value (yellow) below.
  // {blank} keeps the radio's empty slots; {na} keys have no CAT command and are shown grayed.
  'FUNCTION 1/3': { fmenu: true, items: () => [
      { label: 'PAGE 1/3', value: () => 'SSB', page: true, act: () => openPop('FUNCTION 2/3') },
      { label: 'D-LEVEL', func: 'dlevel' },
      { label: 'D-PEAK', func: 'dpeak' },
      { label: 'D-MARKER', value: () => onOff(s.scope[2] === '1'), act: () => radio.setScope(2, s.scope[2] === '1' ? 0 : 1) },
      { label: 'D-COLOR', func: 'dcolor' },
      { label: 'D-CONTRAST', func: 'contrast' },
      { label: 'DIMMER', func: 'dimmer' },
      { label: 'MOX', value: () => onOff(s.mox), act: () => radio.setMox(!s.mox) },
      { label: 'ATT', value: () => onOff(s.att), act: () => radio.setAtt(!s.att) },
      { label: () => (bandType(s.freq[V()]) ? 'AMP' : 'IPO'), value: () => preampText(), act: () => cyclePreamp() },
      { label: 'DNF', value: () => onOff(s.bc[V()]), act: () => radio.setBeatCancel(V(), !s.bc[V()]) },
      { label: 'AGC', value: () => AGC[s.agc[V()]], act: () => radio.setAGC(V(), (s.agc[V()] + 1) % 5) },
      { label: 'MIC EQ', value: () => onOff(s.micEq), act: () => radio.setMicEq(!s.micEq) },
      { label: 'PROC LEVEL', func: 'proc', act: () => radio.setProcOn(!s.procOn), value: () => (s.procOn ? String(s.proc) : 'OFF') },
      { label: 'ANT TUNE', act: () => radio.tune() },
      { label: 'TUNER', value: () => onOff(s.tuner), act: () => radio.setTuner(!s.tuner) },
      { blank: true },
      { label: 'NB', func: 'nb', act: () => radio.setNB(V(), s.nb[V()] ? 0 : (ui.lastNb || 5)) },
      { label: 'DNR', func: 'nr', act: () => radio.setNR(V(), s.nr[V()] ? 0 : (ui.lastNr || 5)) },
      { label: 'ANT', value: () => (s.ex['030704'] === '1' ? 'ANT2' : 'ANT1'), act: () => radio.setEx('030704', s.ex['030704'] === '1' ? 0 : 1) },
      { label: 'TXW', value: () => onOff(s.txw), act: () => radio.setTxw(!s.txw) },
      { label: 'RF POWER', func: 'power' },
      { label: 'MIC GAIN', func: 'mic' },
      { label: 'AMC LEVEL', func: 'amc' },
      { label: 'VOX', value: () => onOff(s.vox), act: () => radio.setVox(!s.vox) },
      { label: 'VOX GAIN', func: 'voxGain' },
      { label: 'VOX DELAY', func: 'voxDelay' },
      { label: 'FWD', nav: '→', act: () => openPop('FUNCTION 2/3') },
    ] },
  'FUNCTION 2/3': { fmenu: true, items: () => [
      { label: 'PAGE 2/3', value: () => 'CW', page: true, act: () => openPop('FUNCTION 3/3') },
      { label: 'MONI LEVEL', func: 'moni', act: () => radio.setMonitorOn(!s.moniOn) },
      { blank: true }, { blank: true }, { blank: true }, { blank: true }, { blank: true },
      { label: 'KEYER', value: () => onOff(s.keyer), act: () => radio.setKeyer(!s.keyer) },
      { label: 'BK-IN', value: () => onOff(s.bkin), act: () => radio.setBreakIn(!s.bkin) },
      { label: 'CW SPEED', func: 'ks' },
      { label: 'CW PITCH', func: 'kp' },
      { label: 'BK-DELAY', func: 'bkDelay' },
      { label: 'ZIN', act: () => radio.zeroIn(V()) },
      { label: 'CW SPOT', value: () => onOff(s.spot), act: () => radio.setSpot(!s.spot) },
      { blank: true }, { blank: true }, { blank: true }, { blank: true },
      { label: 'MESSAGE', act: () => openPop('MESSAGE') },
      { label: 'PLAY', act: () => openPop('PLAY') },
      { label: 'RECORD', act: () => openPop('RECORD') },
      { label: 'BACK', nav: '←', act: () => openPop('FUNCTION 1/3') },
      { blank: true }, { blank: true }, { blank: true }, { blank: true }, { blank: true },
      { label: 'FWD', nav: '→', act: () => openPop('FUNCTION 3/3') },
    ] },
  'FUNCTION 3/3': { fmenu: true, items: () => [
      { label: 'PAGE 3/3', value: () => 'FM/C4FM', page: true, act: () => openPop('FUNCTION 1/3') },
      { label: 'DTMF', na: true },
      { label: 'T-CALL', value: () => 'OFF', na: true },
      { blank: true }, { blank: true },
      { label: 'RPT SHIFT', value: () => RPT[s.os[V()]], act: () => radio.setRptShift(V(), (s.os[V()] + 1) % 4) },
      { label: 'REV', value: () => 'OFF', na: true },
      { label: 'DG-ID TX', value: () => '00', na: true },
      { label: 'DG-ID RX', value: () => '00', na: true },
      { label: 'HRI MODE', value: () => 'OFF', na: true },
      { label: 'APRS', value: () => 'S.LIST', na: true },
      { label: 'APRS', value: () => 'M.LIST', na: true },
      { label: 'APRS', value: () => 'BEACON', na: true },
      { label: 'APRS', value: () => 'BCN-TX', na: true },
      { label: 'CH STEP', value: () => FM_STEP[+s.ex['030606'] || 0] + 'Hz', act: () => radio.setEx('030606', ((+s.ex['030606'] || 0) + 1) % 6) },
      { blank: true }, { blank: true },
      { label: 'SQL TYPE', value: () => SQL_TYPE[s.ct[V()]], act: () => radio.setSqlType(V(), (s.ct[V()] + 1) % 6) },
      { label: 'TONE FREQ', func: 'tone' },
      { label: 'DCS', func: 'dcs' },
      { label: 'HOME', na: true },
      { label: 'BACK', nav: '←', act: () => openPop('FUNCTION 2/3') },
      { label: 'RADIO', value: () => 'SETTING', setting: true, act: () => { closePop(); openSettings(0); } },
      { label: 'CW', value: () => 'SETTING', setting: true, act: () => { closePop(); openSettings(1); } },
      { label: 'OPERATION', value: () => 'SETTING', setting: true, act: () => { closePop(); openSettings(2); } },
      { label: 'DISPLAY', value: () => 'SETTING', setting: true, act: () => { closePop(); openSettings(3); } },
      { label: 'EXTENSION', value: () => 'SETTING', setting: true, act: () => { closePop(); openSettings(4); } },
      { label: 'APRS', value: () => 'SETTING', setting: true, act: () => { closePop(); openSettings(5); } },
    ] },
  ...(IS991 ? F991_SCREENS() : {}),
  MESSAGE: { items: () => [1, 2, 3, 4, 5].map((n) => ({ label: `M${n}`, value: () => 'PLAY', act: () => radio.playMessage(n) }))
    .concat([{ label: 'STOP', act: () => radio.playMessage(0) }]) },
  PLAY: { items: () => [1, 2, 3, 4, 5].map((n) => ({ label: `CH${n}`, value: () => 'PLAY', act: () => radio.playVoice(n) }))
    .concat([{ label: 'STOP', act: () => radio.playVoice(0) }]) },
  RECORD: { items: () => [1, 2, 3, 4, 5].map((n) => ({ label: `CH${n}`, value: () => 'SELECT', act: () => radio.recordVoice(n) }))
    .concat([{ label: 'REC', value: () => 'START/STOP', act: () => radio.recordVoice(0) }]) },
  SPAN: {
    items: () => Object.entries(SC_SPAN).map(([c, t]) => ({ label: t, cur: () => s.scope[5] === c, act: () => radio.setScope(5, c), close: true })),
  },
  SPEED: {
    items: () => SC_SPEED.map((t, i) => ({ label: t, cur: () => s.scope[0] === String(i), act: () => radio.setScope(0, i), close: true })),
  },
  MODE: {
    key: () => MODE_NAME[s.mode[V()]] || '---',
    items: () => MODES.map((m) => ({
      label: m.name, cur: () => s.mode[V()] === m.code, close: true,
      act: () => { if (radio.setMode(V(), m.code) === false) toast('VFO-B のモードは A/B キーで VFO-A と入れ替えてから変えてください'); },
    })),
  },
  BAND: {
    key: () => bandOf(s.freq[V()]).label + (bandOf(s.freq[V()]).ham ? 'M' : ''),
    items: () => [
      ...BANDS.map((b) => ({ label: b.label, value: () => b.name, cur: () => bandOf(s.freq[V()]).code === b.code, act: () => gotoBand(b), close: true })),
    ],
  },
  FILTER: {
    key: () => `W ${widthText(s.mode[V()], s.width[V()], s.nar[V()])}`,
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
  const title = SCREENS[name].title || name;
  $('#popTitle').textContent = target == null ? title : `${title}  ${side(target)}`;
  const grid = $('#popGrid');
  grid.innerHTML = '';
  $('#pop').classList.toggle('fmenu', !!SCREENS[name].fmenu);
  $('#pop').classList.toggle('f991', !!SCREENS[name].f991);
  popItems = SCREENS[name].items().map((it) => {
    if (it.blank) { grid.appendChild(document.createElement('i')); return null; }
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
    if (it.na) { el.classList.add('na'); el.title = it.setting ? '設定メニューはアプリでは未対応' : 'CAT では操作できません'; }
    if (it.page) el.classList.add('page');
    if (it.nav) { el.classList.add('nav'); el.dataset.arrow = it.nav; }
    el.addEventListener('click', () => {
      if (it.na) { toast(it.setting ? '設定メニュー（EX）はアプリでは未対応です' : `${val(it.label)} は CAT では操作できません`); return; }
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
    span.textContent = it.func && !it.value ? paramText(it.func) : (it.value ? it.value() : '');
    el.classList.toggle('on', !!it.on?.());
    el.classList.toggle('cur', !!it.cur?.());
    el.classList.toggle('func', it.func === cfg.func);
  }
}

// bottom touch keys of the scope screen (manual p.28-30, product photo):
// D-MODE / 3DSS / SPAN / SPEED drive the radio's own scope over CAT (SS); MULTI shows/hides this app's AF-FFT;
// SCOPE MAIN/SUB follows the operated side (the CAT protocol has no scope-side command).
// FT-991A: the four keys along the bottom of its screen (manual p.22-23; METER / RF PWR / MIC GAIN as shipped; the fourth
// is SWEEP on the radio, which starts its own scope sweep and has no CAT command, so here it shows / hides the AF-FFT)
const SOFT_KEYS_991 = [
  { name: 'METER', key: () => METERS[cfg.meterSel], act: () => { const k = Object.keys(METERS).map(Number); setMeterSel(k[(k.indexOf(cfg.meterSel) + 1) % k.length]); } },
  { name: 'RF PWR', key: () => `${s.power}W`, act: () => assignFunc('power'), func: 'power' },
  { name: 'MIC GAIN', key: () => String(s.mic), act: () => assignFunc('mic'), func: 'mic' },
  { name: 'AF-FFT', key: () => (cfg.afFft ? 'ON' : 'OFF'), act: () => { cfg.afFft = !cfg.afFft; save(); } },
];
const SOFT_KEYS = IS991 ? SOFT_KEYS_991 : [
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
  if (!IS991) for (let v = 0; v < 2; v++) $(`#filt${v}`).addEventListener('click', () => openPop('FILTER', v));
}

// ---------------- bands: frequency, tags, receiver settings ----------------
const lastFreqHtml = ['', ''];
function freqHtml(hz) {
  const str = String(hz).padStart(9, '0');
  if (IS991) {
    // FT-991A: MHz.kHz and the 100 / 10 Hz digits small, no 1 Hz digit ("14.195 00"); plain characters in the screen font
    const d = (i) => `<span class="d" data-p="${10 ** (8 - i)}">${str[i]}</span>`;
    let mhz = '';
    for (let i = 0; i < 3; i++) if (mhz || str[i] !== '0' || i === 2) mhz += d(i);
    return `${mhz}<span class="dot">.</span>${d(3)}${d(4)}${d(5)}<span class="sm">${d(6)}${d(7)}</span>`;
  }
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
    } else {
      // (FT-991A: the figures are drawn 1.2x wider, css .lcd991 .freq)
      const w = el.scrollWidth * (IS991 ? 1.2 : 1);
      if (w > avail) el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * avail) / w * 0.98}px`;
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
    const wheel = {};
    fel.addEventListener('wheel', (e) => {
      const d = e.target.closest('.d');
      if (!d) return;
      e.preventDefault();
      const n = wheelNotch(e, wheel);
      if (!n || s.lock) return;
      radio.setFreq(v, s.freq[v] + n * +d.dataset.p);
    }, { passive: false });
    band.querySelector('.b-mode').addEventListener('click', () => openPop('MODE', v));
    band.querySelector('.b-tags')?.addEventListener('click', () => { if (s.vs !== v) radio.selectVFO(v); });
    $(`#meter${v}`)?.addEventListener('click', () => openPop('METER'));
    const rx = $(`#rx${v}`);
    if (rx) RX_TILES.forEach((t) => {
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
// FT-991A bar meter scales (manual p.22): S 1-9 / +20 +40 +60dB, PO 0 10 50 100 150W
// (4th field: the figure's place across the meter, measured on the manual's screen picture)
const S_BAR = { name: 'S', hot: 130, unit: 'dB', ticks: [['1', 12, 0, 0.193], ['3', 40, 0, 0.27], ['5', 65, 0, 0.345], ['7', 95, 0, 0.418], ['9', 130, 0, 0.493],
  ['+20', 172, 0, 0.599], ['+40', 220, 0, 0.709], ['+60', 255, 0, 0.808]] };
const PO_BAR = { name: 'PO', unit: 'W', ticks: [['0', 0, 0, 0.153], ['10', poRaw(10, 150), 0, 0.324], ['50', poRaw(50, 150), 0, 0.547],
  ['100', poRaw(100, 150), 0, 0.69], ['150', 255, 0, 0.833]] };
function drawMeters() {
  if (IS991) {
    const m = meters[0];
    m.configure({ top: S_BAR, bottom: cfg.meterSel === 5 ? PO_BAR : TX_SCALES[cfg.meterSel], reading: s.tx ? 'bottom' : 'top' });
    m.set(s.tx ? s.meters[cfg.meterSel] : s.smeter[0]);
    return;
  }
  const bottom = cfg.meterSel === 5 ? poScale() : TX_SCALES[cfg.meterSel];
  for (let v = 0; v < 2; v++) {
    const m = meters[v];
    const txBand = s.tx && s.ft === v;
    // while transmitting, the meter on the opposite side turns gray
    // both sides show the S scale and the selected TX meter (manual p.17)
    m.configure({ top: S_SCALE, bottom, reading: txBand ? 'bottom' : 'top', dimmed: s.tx && !txBand });
    const rxOn = v === 0 || s.dual || s.vs === 1;
    m.set(txBand ? s.meters[cfg.meterSel] : s.tx || !rxOn ? 0 : s.smeter[v]);
    // bottom row: what the AF/RF/SQL knob turns now (VOL = AF GAIN), as on the radio
    const kind = knobMode(v);
    m.setVol((kind === 'sql' ? s.sql[v] : kind === 'rf' ? s.rf[v] : s.af[v]) / 255, kind === 'sql' ? 'SQL' : kind === 'rf' ? 'RF' : 'VOL');
  }
}

// ---------------- filter function display ----------------
function drawFilters() {
  for (let v = 0; v < filters.length; v++) {
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
// FT-991A: AF GAIN, RF GAIN (SQL is a MULTI function there), CLAR/VFO-B (VFO-B in split, else the clarifier), MULTI
function setupKnobs991() {
  const afTurn = (n) => {
    if (cfg.spkMute) {
      cfg.rxVol = clamp(Math.round((cfg.rxVol + n * 0.03) * 100) / 100, 0, 2);
      $('#rxVol').value = cfg.rxVol; audio.setRxVolume(cfg.rxVol); save();
      popup('PC VOLUME', `${Math.round(cfg.rxVol * 50)}%`, cfg.rxVol / 2);
      return;
    }
    const nv = clamp(s.af[0] + n * 4, 0, 255);
    radio.setAF(0, nv);
    popup('AF GAIN', pct255(nv), nv / 255);
  };
  // (the FT-991A's knobs turn by circling them)
  afKnobs.push({ k: new Knob($('#knAF0'), { onTurn: afTurn, angular: true, accel: true }), v: 0, kind: 'af' });
  afKnobs.push({ k: new Knob($('#knRF'), {
    angular: true, accel: true,
    onTurn: (n) => { const nv = clamp(s.rf[0] + n * 4, 0, 255); radio.setRF(0, nv); popup('RF GAIN', pct255(nv), nv / 255); },
  }), v: 0, kind: 'rf' });
  const multi = new Knob($('#knFunc'), {
    angular: true, accel: true,
    onTurn: (n) => {
      // menu: MULTI moves through the items; after SELECT it changes the value (as on the radio)
      if (!$('#exm').hidden && exSel) { if (ui.exEdit) exAdjust(n); else exMove(n); multi.showFree(); return; }
      if (cfg.func === 'chd') {
        if (s.lock) { popup('LOCK', 'DIAL LOCK', 0); return; }
        const step = chdSteps()[chdIdx()] * 1000;
        radio.setFreq(0, Math.round(s.freq[0] / step) * step + n * step);
      } else adjust(cfg.func, n);
      multi.showFree();
    },
  });
  const cv = new Knob($('#knSubDial'), {
    angular: true, degPerStep: 10, accel: true,
    onTurn: (n) => {
      if (isSplit()) tune(n, 1);
      else adjust('clar', n);
      cv.showFree();
    },
  });
  ui.dial = new Dial($('#dial'), { stepsPerRev: +cfg.dialRes, onStep: (n) => tune(n, 0) });
}
function setupKnobs() {
  if (IS991) { setupKnobs991(); return; }
  for (let v = 0; v < 2; v++) {
    const k = new Knob($(`#knAF${v}`), {
      onTurn: (n) => {
        const kind = knobMode(v);
        if (kind === 'af' && cfg.spkMute) {
          // radio speaker muted: the AF knobs set the PC playback volume instead
          cfg.rxVol = clamp(Math.round((cfg.rxVol + n * 0.03) * 100) / 100, 0, 2);
          $('#rxVol').value = cfg.rxVol; audio.setRxVolume(cfg.rxVol); save();
          popup('PC VOLUME', `${Math.round(cfg.rxVol * 50)}%`, cfg.rxVol / 2);
          return;
        }
        const cur = kind === 'af' ? s.af[v] : kind === 'rf' ? s.rf[v] : s.sql[v];
        const nv = clamp(cur + n * 4, 0, 255);
        if (kind === 'af') radio.setAF(v, nv); else if (kind === 'rf') radio.setRF(v, nv); else radio.setSQL(v, nv);
        popup(`${kind.toUpperCase()} ${kind === 'af' ? 'GAIN ' : kind === 'rf' ? 'GAIN ' : ''}${side(v)}`, pct255(nv), nv / 255);
      },
      // press switches the knob between AF and RF (SSB/CW/DATA) or SQL (AM/FM)
      onPress: () => {
        ui.knMode[v] = ui.knMode[v] === 'af' ? 'alt' : 'af';
        const kind = knobMode(v), val = kind === 'af' ? s.af[v] : kind === 'rf' ? s.rf[v] : s.sql[v];
        popup(`${kind.toUpperCase()} ${side(v)}`, pct255(val), val / 255);
        render();
      },
    });
    afKnobs.push({ k, v });
  }

  const func = new Knob($('#knFunc'), {
    pxPerStep: 6,
    onTurn: (n) => {
      if (!$('#exm').hidden && exSel) { exAdjust(n); func.showFree(); return; }
      // a radio-only function (D-LEVEL ...) has no CAT command to adjust; say so instead of turning something else
      if (radio.connected && ui.funcRadioOnly) { popup(SF_NAME[s.sf], '本体で操作', 0); func.showFree(); return; }
      adjust(cfg.func, n); func.showFree();
    },
    onPress: () => (SCREENS[ui.pop]?.fmenu ? closePop() : openPop('FUNCTION 1/3')),
  });

  const sub = new Knob($('#knSubDial'), {
    pxPerStep: 3,
    onTurn: (n) => { tune(n, 1); sub.showFree(); },
    onPress: () => radio.swap(),
  });

  ui.dial = new Dial($('#dial'), { stepsPerRev: +cfg.dialRes, onStep: (n) => tune(n, 0) });
}

// default dial steps per mode (FTX-1 manual p.11): normal / [FINE] / (FAST)
// STEP AUTO: the radio's own dial steps (OPERATION SETTING → KEY/DIAL, read on connecting). FM DIAL STEP "Auto" is not
// described in the manuals; it is taken as 5 kHz below 60 MHz and 20 kHz above (Japanese channel spacing).
const DIAL_HZ = [5, 10, 20], FM_DIAL_HZ = [5000, 6250, 10000, 12500, 20000, 25000];
function modeStep(mode, v = 0) {
  // FT-991A (manual p.21): 5 / 10 Hz (the function menu's 5/10Hz), FM / C4FM / DATA-FM 100 Hz; FAST is 100 Hz / 1 kHz
  if (IS991) return isFM(mode) ? 100 : cfg.dial991 || 10;
  if (['1', '2', '3', '7'].includes(mode)) return DIAL_HZ[+(s.ex['030601'] ?? 2)] || 20;          // SSB / CW
  if (['6', '9', '8', 'C', 'E'].includes(mode)) return DIAL_HZ[+(s.ex['030602'] ?? 1)] || 10;     // RTTY / DATA / PSK
  if (isFM(mode)) return FM_DIAL_HZ[+(s.ex['030603'] ?? 6)] || (s.freq[v] < 60e6 ? 5000 : 20000); // FM
  if (mode === '5' || mode === 'D') return 100; // AM: the radio has no dial step setting for it
  return 10;
}
function curStep(v = 0) {
  const base = cfg.step === 'auto' ? modeStep(s.mode[v], v) : cfg.step;
  if (ui.fine) return isFM(s.mode[v]) || s.mode[v] === '5' || s.mode[v] === 'D' ? 10 : 1;
  if (ui.fast) return IS991 && cfg.step === 'auto' ? (isFM(s.mode[v]) ? 1000 : 100) : base * 10;
  return base;
}
function tune(n, v) {
  if (s.lock) { popup('LOCK', 'DIAL LOCK', 0); ui.dial.stop(); return; }
  // with CLAR active the dial moves the clarifier offset instead of the frequency (FT-991A: CLAR/VFO-B knob does that)
  if (!IS991 && v === 0 && (s.clarRx[0] || s.clarTx[0])) {
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
  if (!on) ui.ft8Halt?.(); // PTT released by anything else (TOT, button, window hidden) ends an FT8 transmission
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
  // (an FT8 transmission is timed and ends by itself, so it may go on in the background)
  window.addEventListener('blur', () => { if (!ui.ft8Busy?.()) setPtt(false); });
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
  back: { press: () => { if (!$('#exm').hidden) { closeSettings(); return; } closePop(); $('#popup').hidden = true; }, hold: () => {} },
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
  // FT-991A front panel (manual p.18-21)
  ab: () => { radio.copyAtoB(); popup('A=B', 'VFO-A → VFO-B', 1); },
  tune991: { press: () => radio.setTuner(!s.tuner), hold: () => { radio.tune(); popup('TUNE', 'AUTO TUNE', 1); } },
  cs: () => toast('C.S（カスタムスイッチ）は CAT では操作できません'),
  // TXW: listens on the transmit frequency while held
  txw: { down: () => radio.setTxw(true), up: () => radio.setTxw(false) },
  fast: () => radio.setFine(s.fn === 2 ? 0 : 2),
  lock: () => radio.setLock(!s.lock),
  clar991: {
    press: () => { const on = s.clarRx[0] || s.clarTx[0]; radio.setClar(0, !on, false); },
    hold: () => { radio.setClarOffset(0, 0); popup('CLAR', '0Hz', 0.5); },
  },
  am991: { press: () => toast('メモリーチェックは CAT では操作できません（長押しでメモリー書込）'), hold: () => { radio.memWrite(); popup('A▸M', 'MEMORY WRITE', 1); } },
  split991: { press: toggleSplit, hold: () => { radio.quickSplit(); popup('SPLIT', 'QUICK SPLIT', 1); } },
  fkey: { press: () => (SCREENS[ui.pop]?.f991 ? closePop() : openPop(Object.keys(SCREENS).find((k) => SCREENS[k].f991))), hold: () => toast('メモリーリストは CAT では表示できません') },
  menu991: { press: () => { if ($('#exm').hidden) { closePop(); openSettings(0); } else closeSettings(); }, hold: () => toast('SETUP（MY CALL など）は CAT では操作できません') },
  band991: () => (ui.pop === 'BAND' ? closePop() : openPop('BAND')),
  mode991: () => (ui.pop === 'MODE' ? closePop() : openPop('MODE', 0)),
};
const stepText = (st) => (st >= 1000 ? `${st / 1000}kHz` : `${st}Hz`);

function setupKeys() {
  $$('[data-act]').forEach((el) => {
    const a = ACTIONS[el.dataset.act];
    if (!a) return;
    if (typeof a === 'function') { el.addEventListener('click', () => { a(); render(); }); return; }
    if (a.down) {
      // momentary key: on while pressed
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); a.down(); render(); });
      for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, () => { a.up(); render(); });
      return;
    }
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
// the CAT port used last time (USB IDs, position among the radio's ports, rate), kept per radio
const CATPORT = IS991 ? 'catPort991' : 'catPort';
function onConnected(baud) {
  $('#btnConnect').classList.remove('connecting');
  if (!audio.rx) startRxAudio({ quiet: true });
  // (FT-991A: TX audio starts with POWER on as RX does; left off, the radio is keyed with no audio)
  if (IS991 && !audio.tx) startTxAudio();
  // ID answer: FTX-1 0840 (CAT manual 2512-D; 0800 in 2508-C); FT-991 0570 (CAT manual 1808-D), FT-991A 0670
  const other = s.id && !(IS991 ? ['0570', '0670'] : ['0800', '0840']).includes(s.id);
  toast(`CAT接続しました（${baud}bps${other ? ` / ID ${s.id}: ${MODEL_NAME}ではない可能性。SETUP の機種を確かめてください` : ''}）`, other);
  if (cfg.keyPortAuto) openKeyPortAuto();
  // the radio's dial steps, for STEP AUTO
  if (!IS991) for (const k of ['030601', '030602', '030603']) radio.send(`EX${k};`, { read: true });
}
async function toggleConnect(e) {
  if (e?.shiftKey) ui.forcePick = true;
  if (!('serial' in navigator)) { toast('Web Serial 非対応のブラウザです', true); return; }
  if (radio.connected) {
    // POWER off: the radio's audio and second port go too (they come back by themselves at the next POWER on)
    await setPtt(false);
    await radio.disconnect();
    await audio.stopRx();
    await audio.stopTx();
    if (ui.pttLink?.isOpen) { await ui.pttLink.close().catch(() => {}); ui.pttLink = null; $('#pttPortState').textContent = '未接続（POWER ON で自動接続）'; }
    return;
  }
  $('#btnConnect').classList.add('connecting');
  // POWER: reconnect to the port used last time (already granted, same USB IDs, same position) without the picker;
  // Shift+click, or no answer from the remembered port, opens the picker
  if (!ui.forcePick) {
    try {
      const ports = await navigator.serial.getPorts();
      const last = cfg[CATPORT];
      const same = ports.filter((p) => { const i = p.getInfo(); return last && i.usbVendorId === last.vid && i.usbProductId === last.pid; });
      const order = [same[last?.idx], ...same].filter((p, i, a) => p && a.indexOf(p) === i);
      // only the rate that worked last time, so a port that does not answer leads to the picker within a second or two
      // (it has to open while Chrome still counts the click)
      for (const p of order) {
        try {
          const baud = await radio.connect(p, cfg[CATBAUD] === 'auto' && last.baud ? last.baud : cfg[CATBAUD]);
          last.baud = baud; save();
          onConnected(baud);
          return;
        } catch {}
      }
    } catch {}
  }
  ui.forcePick = false;
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch { $('#btnConnect').classList.remove('connecting'); return; } // picker cancelled
  try {
    const baud = await radio.connect(port, cfg[CATBAUD]);
    const info = port.getInfo();
    const same = (await navigator.serial.getPorts()).filter((p) => { const i = p.getInfo(); return i.usbVendorId === info.usbVendorId && i.usbProductId === info.usbProductId; });
    cfg[CATPORT] = { vid: info.usbVendorId, pid: info.usbProductId, idx: Math.max(0, same.indexOf(port)), baud };
    save();
    onConnected(baud);
    return;
  } catch (e) {
    if (e.code === 'NO_REPLY') {
      toast(cfg[CATBAUD] === 'auto'
        ? `このポートはCATに応答しません。${MODEL_NAME}のもう一方のシリアルポートを選んでください（受信した内容は CAT CONSOLE に出ています）`
        : `${cfg[CATBAUD]}bpsで応答がありません。ボーレートを「自動」にするか、もう一方のポートを選んでください`, true);
    } else {
      toast(`ポートを開けません: ${e.message}（他のアプリが使用中の可能性）`, true);
    }
  } finally {
    $('#btnConnect').classList.remove('connecting');
  }
}
radio.addEventListener('connection', () => {
  logLine('sys', radio.connected ? `connected @ ${radio.baud}bps` : 'disconnected');
  if (!radio.connected) { ui.ptt = false; clearTimeout(ui.totTimer); audio.setTxOpen(!cfg.txGate); }
  render();
});

// The radio's second serial port (Standard COM Port / CAT-2): CW keying and RTS/DTR PTT. Once opened, it is opened
// again by itself whenever CAT connects (the FTX-1 has two ports: the one of the same device that is not the CAT port);
// closing it by hand stops that.
async function openKeyPort(port) {
  const link = new SerialLink();
  await link.open(port, 38400, { framed: false });
  await link.setSignals({ requestToSend: false, dataTerminalReady: false });
  link.addEventListener('close', () => { $('#pttPortState').textContent = '切断'; });
  ui.pttLink = link;
  $('#pttPortState').textContent = '2 本目のポート接続中（CW キーイング・RTS/DTR の PTT）';
}
// the radio's other port, among those Chrome already allows (same USB IDs as the CAT port, not the CAT port)
async function otherPorts() {
  const cat = radio.link?.port;
  if (!cat) return [];
  const ci = cat.getInfo();
  return (await navigator.serial.getPorts()).filter((p) => {
    const i = p.getInfo();
    return p !== cat && i.usbVendorId === ci.usbVendorId && i.usbProductId === ci.usbProductId;
  });
}
// USB unplugged / radio restarted: the second port is gone; it is opened again when the radio's ports come back
navigator.serial?.addEventListener('disconnect', (e) => {
  if (ui.pttLink && e.target === ui.pttLink.port) { ui.pttLink = null; $('#pttPortState').textContent = '切断（USB が戻ると自動で接続）'; }
});
navigator.serial?.addEventListener('connect', () => { if (cfg.keyPortAuto && radio.connected) setTimeout(openKeyPortAuto, 1000); });
async function openKeyPortAuto() {
  if (ui.pttLink?.isOpen || !radio.link?.port) return false;
  try {
    for (const p of await otherPorts()) {
      try { await openKeyPort(p); return true; } catch {}
    }
  } catch {}
  return false;
}
// 「CWキーイング」: close it, or open the radio's other port: without the picker when Chrome already allows it; in the
// picker, choosing the CAT port is caught (the picker needs a click, so the user presses the button again)
async function togglePttPort() {
  if (ui.pttLink?.isOpen) {
    await ui.pttLink.close();
    ui.pttLink = null;
    cfg.keyPortAuto = false; save();
    $('#pttPortState').textContent = '未接続（CATポートを使用）';
    return;
  }
  if (await openKeyPortAuto()) { cfg.keyPortAuto = true; save(); return; }
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch { return; } // picker cancelled
  if (port === radio.link?.port) {
    toast('選んだのは POWER（CAT）で使用中のポートです。もう一度「CWキーイング」を押して、もう一方を選んでください', true, 7000);
    return;
  }
  try {
    await openKeyPort(port);
    cfg.keyPortAuto = true; save();
  } catch (e) {
    toast(`2 本目のポートを開けません: ${e.message}`, true);
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
  // editor: sent text stays, locked and coloured, the rest is editable while sending; finished lines go to the log
  const editor = $('#cwText');
  // keying: PC KEYING (FTX-1 EX020114: 1 RTS / 2 DTR; FT-991A EX060: 2 RTS / 3 DTR) on the radio's second port
  // (SETUP「CWキーイング」); null = ready, otherwise why it cannot key
  const PCK = IS991 ? { key: '060', rts: '2', dtr: '3', where: 'メニュー 060 PC KEYING' } : { key: '020114', rts: '1', dtr: '2', where: 'PC KEYING（CW SETTING → MODE CW）' };
  const keyProblem = () => {
    const v = s.ex[PCK.key], line = v === PCK.dtr ? 'dtr' : v === PCK.rts ? 'rts' : null;
    if (!radio.connected) return 'CAT が接続されていません';
    if (!ui.pttLink?.isOpen) return 'SETUP の「CWキーイング」で 2 本目のポート（Standard COM Port）を開いてください';
    if (v == null) return '本体の PC KEYING を読み込み中です（少し待ってからもう一度）';
    if (!line) return `本体の ${PCK.where} を DTR か RTS にしてください`;
    if (cfg.pttMethod === line) return `${line.toUpperCase()} は PTT に使っているのでキーイングに使えません（SETUP の PTT 方式を CAT に）`;
    return null;
  };
  // the line is driven on both of the radio's ports: PC KEYING works on the Standard port (CAT-2), and Chrome cannot tell
  // which of the two that is (after the radio restarts, CAT may well be on it); the line is unused on the other port
  const keyer = () => {
    if (keyProblem()) return null;
    const sig = s.ex[PCK.key] === PCK.dtr ? 'dataTerminalReady' : 'requestToSend';
    // (FT-991A: the CAT port's RTS is the CAT handshake of menu 033 and DTR on it garbles CAT, so keying stays on the
    // second port)
    const links = IS991 ? [ui.pttLink] : [ui.pttLink, radio.link];
    return async (on) => {
      const r = await Promise.allSettled(links.map((l) => l.setSignals({ [sig]: on })));
      if (r.every((x) => x.status === 'rejected')) throw r[0].reason;
    };
  };
  const cw = new CwSender(radio, { editor, back: $('#cwBack'), log: $('#cwLog') }, keyer);
  // PC KEYING: read on connecting and again on each start
  const readCwSettings = () => radio.send(`EX${PCK.key};`, { read: true });
  radio.addEventListener('connection', () => { if (radio.connected) setTimeout(readCwSettings, 2000); });
  setInterval(() => {
    // shown only when it cannot send (hover for the reason)
    const why = keyProblem();
    $('#cwHow').hidden = !why;
    $('#cwHow').title = why || '';
  }, 500);
  cw.addEventListener('error', (e) => toast(`CW キーイング失敗: ${e.detail.message}`, true));
  // timers are throttled in a hidden window, which would garble the keying
  document.addEventListener('visibilitychange', () => { if (document.hidden && cw.active) { cw.stop(); toast('ウインドウが隠れたので CW 送信を止めました', true); } });
  const start = () => {
    if (!editor.value.trim()) return;
    if (!cw.active) readCwSettings();
    const why = keyProblem();
    if (why) { toast(`CW を送信できません: ${why}`, true, 6000); return; }
    if (!isCW(s.mode[s.ft])) toast('CWモードではありません（送信されない場合があります）');
    cw.start();
  };
  cw.addEventListener('state', () => $('#btnCwSend').classList.toggle('on', cw.active));
  // key speed slider: the radio's KEY SPEED (the keying follows it)
  const sp = $('#cwSpeed');
  sp.addEventListener('pointerdown', () => { ui.cwSpeedDrag = true; });
  addEventListener('pointerup', () => { ui.cwSpeedDrag = false; });
  // the number follows the drag; the radio gets the value once, on release (fewer writes to it)
  sp.addEventListener('input', () => { $('#cwWpm').textContent = sp.value; });
  sp.addEventListener('change', () => radio.setKeySpeed(+sp.value));
  $('#btnCwSend').addEventListener('click', start);
  $('#btnCwStop').addEventListener('click', () => cw.stop());
  // Enter sends; Shift+Enter is a new line
  editor.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); start(); } });
  const mem = $('#cwMem'); // shares the key row with SEND / STOP
  cfg.cwMem.forEach((txt, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `M${i + 1}`;
    const upd = () => { b.classList.toggle('has', !!cfg.cwMem[i]); b.title = `${cfg.cwMem[i] || '(空)'}\nクリックで送信 / Shift+クリックで入力欄の文を登録`; };
    upd();
    b.addEventListener('click', (e) => {
      if (e.shiftKey) {
        cfg.cwMem[i] = editor.value.toUpperCase();
        save();
        upd();
        toast(`M${i + 1} に登録しました`);
      } else if (cfg.cwMem[i]) {
        // queued after what is already waiting in the editor
        editor.value = editor.value && !/\s$/.test(editor.value) ? `${editor.value} ${cfg.cwMem[i]}` : editor.value + cfg.cwMem[i];
        start();
      }
    });
    mem.appendChild(b);
  });
}

// ---------------- audio ----------------
// audio devices chosen in USB AUDIO, kept per radio (both radios may be connected to the PC)
const AUDIO = Object.fromEntries(['rxIn', 'rxOut', 'txIn', 'txOut'].map((k) => [k, IS991 ? `${k}991` : k]));
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
  // this radio's own device first (with both radios connected), then any radio's: on macOS the FT-991A is
  // "USB Audio CODEC" and the FTX-1 "USB Audio Device" (on Windows both are "USB Audio CODEC")
  const own = IS991 ? /USB Audio CODEC/i : /USB Audio Device|FTX/i;
  const radioDev = (l) => l.find((d) => own.test(d.label)) || l.find(isRadioDevice);
  const pcDev = (l) => l.find((d) => d.deviceId === 'default') || l.find((d) => !isRadioDevice(d));
  fillSelect($('#rxIn'), inputs, cfg[AUDIO.rxIn], radioDev);
  fillSelect($('#rxOut'), outputs, cfg[AUDIO.rxOut], pcDev);
  fillSelect($('#txIn'), inputs, cfg[AUDIO.txIn], pcDev);
  fillSelect($('#txOut'), outputs, cfg[AUDIO.txOut], radioDev);
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
    if (sel && !isRadioDevice({ label: sel.textContent }) && !cfg[AUDIO.rxIn]) toast(`${MODEL_NAME}のオーディオデバイスが見つかりません。RX入力を選択してください`, true);
    await audio.startRx({ inputId: $('#rxIn').value, outputId: $('#rxOut').value, volume: +cfg.rxVol });
  } catch (e) {
    if (!quiet) toast(`RXオーディオ開始失敗: ${e.message}`, true);
  }
}
async function startTxAudio() {
  try {
    await audio.unlockLabels();
    await refreshDevices();
    await audio.startTx({ micId: $('#txIn').value, outputId: $('#txOut').value, gain: +cfg.txGain });
    audio.setTxOpen(!cfg.txGate || ui.ptt);
    return true;
  } catch (e) { toast(`TXオーディオ開始失敗: ${e.message}`, true); return false; }
}
function setupAudio() {
  $('#rxVol').value = cfg.rxVol;
  $('#txGain').value = cfg.txGain;
  $('#txGate').checked = cfg.txGate;
  ['rxIn', 'rxOut', 'txIn', 'txOut'].forEach((id) => $(`#${id}`).addEventListener('change', (e) => { cfg[AUDIO[id]] = e.target.value; save(); }));

  $('#btnRx').addEventListener('click', () => (audio.rx ? audio.stopRx() : startRxAudio()));
  $('#scope').addEventListener('click', () => { if (!audio.rx) startRxAudio(); });
  $('#btnMute').addEventListener('click', () => {
    if (!audio.rx) return;
    audio.setRxMute(!audio.rx.muted);
    audio.dispatchEvent(new Event('state'));
  });
  // radio speaker mute: AF GAIN 0 on both sides (the USB audio level is set by the menu's USB OUT LEVEL, not AF GAIN);
  // the previous AF GAIN comes back when unchecked
  $('#spkMute').checked = !!cfg.spkMute;
  const applyMute = () => {
    if (!radio.connected) return;
    if (cfg.spkMute) { cfg.afSaved = s.af.some((x) => x > 0) ? [...s.af] : cfg.afSaved; radio.setAF(0, 0); radio.setAF(1, 0); }
    else if (cfg.afSaved) { radio.setAF(0, cfg.afSaved[0]); radio.setAF(1, cfg.afSaved[1]); }
    save();
  };
  $('#spkMute').addEventListener('change', (e) => { cfg.spkMute = e.target.checked; applyMute(); render(); });
  radio.addEventListener('connection', () => { if (radio.connected && cfg.spkMute) setTimeout(applyMute, 1500); });
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

  $('#btnTx').addEventListener('click', () => (audio.tx ? audio.stopTx() : startTxAudio()));
  $('#txGain').addEventListener('input', (e) => { cfg.txGain = +e.target.value; audio.setTxGain(cfg.txGain); save(); });
  $('#txGate').addEventListener('change', (e) => { cfg.txGate = e.target.checked; audio.setTxOpen(!cfg.txGate || ui.ptt); save(); });
  $('#txTone').addEventListener('change', (e) => audio.setTone(e.target.checked));
  $('#pcSql').checked = cfg.pcSql;
  $('#pcSql').addEventListener('change', (e) => { cfg.pcSql = e.target.checked; save(); render(); });
  // the microphone was cut off: open it again (keeping the 1 kHz tone if it was on); give up with a message if it fails
  let reopening = false;
  audio.addEventListener('txended', async () => {
    if (reopening) return;
    reopening = true;
    const tone = $('#txTone').checked;
    await audio.stopTx();
    await new Promise((r) => setTimeout(r, 500));
    if (await startTxAudio()) {
      if (tone) { $('#txTone').checked = true; audio.setTone(true); }
      toast('マイクが切れたので開き直しました');
    } else toast('マイクが切れました。開き直せないので TX音声を止めました', true);
    reopening = false;
  });

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
  // FT-991A: after its USB audio went away and came back (cable pulled, radio switched off and on), audio that was
  // running on it stays silent without an error (TX keeps playing into the old device): open it again on the new one
  if (IS991) {
    const codec = (l) => l.some((d) => /USB Audio CODEC/i.test(d.label));
    let gone = null, rxWas = false, rxOffAt = 0;
    audio.addEventListener('state', () => {
      if (rxWas && !audio.rx) rxOffAt = performance.now();
      rxWas = !!audio.rx;
    });
    audio.addEventListener('devicechange', async () => {
      const { inputs, outputs } = await audio.devices();
      if (!codec(inputs) || !codec(outputs)) {
        // (RX ends by itself as its input disappears, just before this event)
        if (!gone) gone = { tx: !!audio.tx, rx: !!audio.rx || performance.now() - rxOffAt < 5000 };
        return;
      }
      if (!gone) return;
      const was = gone;
      gone = null;
      if (!was.tx && !was.rx) return;
      if (ui.ptt) await setPtt(false);
      await refreshDevices();
      if (was.tx) { await audio.stopTx(); await startTxAudio(); }
      if (was.rx) await startRxAudio({ quiet: true });
      toast(`${MODEL_NAME}のUSBオーディオがつなぎ直されたので、${[was.tx && 'TX', was.rx && 'RX'].filter(Boolean).join('/')}音声を開き直しました`);
    });
  }
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
  // radio model: the page is built for one radio, so a change reloads it (the CAT link is closed first)
  $('#model').value = IS991 ? 'ft991a' : 'ftx1';
  $('#model').addEventListener('change', async (e) => {
    cfg.model = e.target.value;
    save();
    if (radio.connected) { await setPtt(false); await radio.disconnect(); }
    location.reload();
  });
  $$('.model-name').forEach((el) => { el.textContent = MODEL_NAME; });
  if (IS991) {
    // FT-991A: one CAT RATE (menu 031) up to 38400 bps; TX2 is an FTX-1 command
    // the radio's CAT RATE is menu 031 (MENU screen), which reconnects by itself: no separate setting here
    $('#radioBaudLabel').parentElement.hidden = true;
    $('#baud').querySelector('option[value="115200"], option:last-child').remove();
    if (![4800, 9600, 19200, 38400].includes(cfg[CATBAUD])) cfg[CATBAUD] = 'auto';
    $('#pttMethod').querySelector('[value="cat2"]').remove();
    if (cfg.pttMethod === 'cat2') cfg.pttMethod = 'cat1';
  }
  bindSel('baud', CATBAUD, () => { if (radio.connected) toast('ボーレートは再接続後に反映されます'); });
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
    const which = IS991 ? 'CAT RATE（メニュー 031）' : 'CAT-1 / CAT-2 ボーレート';
    if (!confirm(`本体の ${which} を ${rate}bps に変更して再接続します。よろしいですか？`)) return;
    try {
      await radio.setRadioBaud(rate);
      cfg[CATBAUD] = rate;
      $('#baud').value = String(rate);
      save();
      toast(`本体の ${which} を ${rate}bps にしました`);
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
  dec.nr = cfg.decNr;
  // display and controls as cw_decoder4's web page
  new CwView(dec, {
    panel: $('#panelDec'), text: $('#decText'), fft: $('#decFft'), scope: $('#decScope'),
    fftCard: $('#decFftCard'), scopeCard: $('#decScopeCard'), fftCap: $('#decFftCap'), scopeCap: $('#decScopeCap'),
    scopeSpan: $('#decScopeSpan'), zoom: $('#decZoom'), zoomV: $('#decZoomV'), bKey: $('#decKey'), bEnv: $('#decEnv'), bRaw: $('#decRaw'),
    mode: $('#btnDecMode'), tone: $('#btnDecTone'), wpm: $('#decWpm'), toneHz: $('#decTone'), peakHz: $('#decPeak'),
    lvlBar: $('#decLvlBar'), lvlTx: $('#decLvl'), clip: $('#decClip'), inRate: $('#decRate'), copy: $('#btnDecCopy'), clear: $('#btnDecClr'),
  });
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

  $('#btnDec').addEventListener('click', () => {
    cfg.dec = !cfg.dec;
    save();
    $('#btnDec').classList.toggle('on', cfg.dec);
    if (cfg.dec && !audio.rx) startRxAudio();
    sync();
  });
  $('#decCh').value = cfg.decCh;
  $('#decCh').addEventListener('change', (e) => { cfg.decCh = e.target.value; dec.setChannel(cfg.decCh); save(); });
  $('#decNr').checked = cfg.decNr;
  $('#decNr').addEventListener('change', (e) => { cfg.decNr = e.target.checked; dec.setNr(cfg.decNr); save(); });
  const gainLabel = () => { $('#decGainV').textContent = `${cfg.decGain > 0 ? '+' : ''}${cfg.decGain} dB`; };
  $('#decGain').value = cfg.decGain;
  gainLabel();
  $('#decGain').addEventListener('input', (e) => { cfg.decGain = +e.target.value; dec.setGain(cfg.decGain); gainLabel(); save(); });

  setInterval(() => $('#decLed').classList.toggle('on', dec.active && dec.gate), 100);
  $('#btnDec').classList.toggle('on', cfg.dec);
}

// ---------------- settings menus (EX) ----------------
// Groups on the left, the selected group's items on the right (as the radio's setting screens). Values are read with
// EX P1P2P3; when a group is opened; an item is changed with the FUNC knob, the mouse wheel or a click on its value.
let exMenu = null, exGroup = null, exSel = null;
// FT-991A: one numbered list (001-153, shown with the numbers)
const EXM = IS991 ? EX_MENUS_991 : EX_MENUS, EXD = IS991 ? EX_DEFAULTS_991 : EX_DEFAULTS;
function exText(it, raw) {
  if (raw == null) return '…';
  if (it.t === 'na') return '—';
  if (it.t === 'text') return raw.trim() || '(空)';
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return raw;
  if (it.t === 'opt') return (it.o.find((o) => o[0] === v) || [0, raw])[1];
  const x = v / it.k;
  return `${it.s && x > 0 ? '+' : ''}${it.k > 1 ? x.toFixed(1) : x}${it.u || ''}`;
}
function exEncode(it, v) {
  if (it.t === 'opt') return pad(v, it.n);
  if (it.s) return `${v < 0 ? '-' : '+'}${pad(Math.abs(v), it.n - 1)}`;
  return pad(v, it.n);
}
const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, '0');
function exStep(it, raw, n) {
  const v = parseInt(raw, 10);
  if (it.t === 'opt') {
    const codes = it.o.map((o) => o[0]);
    const i = Math.max(0, codes.indexOf(v));
    return codes[clamp(i + n, 0, codes.length - 1)];
  }
  return clamp((Number.isFinite(v) ? v : it.lo) + n * it.st, it.lo, it.hi);
}
// turning (wheel / FUNC knob) shows each step at once; the radio gets the final value once turning has stopped for a
// moment (fewer writes to it)
let exTimer = null, exPending = null;
const exWheel = {}; // (one wheel state for all rows of the settings menu)
function exFlush() {
  clearTimeout(exTimer);
  // (turned back to where it started: nothing to send)
  if (exPending && exPending.v !== exPending.from) sendEx(exPending.key, exPending.v);
  exPending = null;
}
// FT-991A menu 031 CAT RATE changes the rate of the port in use: the app reconnects at the new rate
const BAUD_ITEM = IS991 ? '031' : null, BAUD_CODES = [4800, 9600, 19200, 38400];
function sendEx(key, v) {
  if (key !== BAUD_ITEM) { radio.setEx(key, v); return; }
  const rate = BAUD_CODES[+v];
  if (!rate) return;
  radio.setRadioBaud(rate).then(() => {
    if (cfg[CATPORT]) cfg[CATPORT].baud = rate;
    if (cfg[CATBAUD] !== 'auto') cfg[CATBAUD] = rate;
    save();
    toast(`本体の CAT RATE を ${rate}bps にして、つなぎ直しました`);
  }).catch((e) => toast(`CAT RATE 変更後の再接続に失敗しました: ${e.message}（⏻ で接続し直してください）`, true));
}
function exAdjust(n) {
  const { it, key } = exSel;
  if (it.t !== 'opt' && it.t !== 'num') return;
  if (exPending && exPending.key !== key) exFlush(); // another item: the previous one goes now
  const from = exPending ? exPending.from : s.ex[key];
  const v = exEncode(it, exStep(it, s.ex[key], n));
  s.ex[key] = v;
  exPending = { key, v, from };
  clearTimeout(exTimer);
  // (CAT RATE goes only on ENTER: each change reconnects)
  if (key !== BAUD_ITEM) exTimer = setTimeout(exFlush, 400);
  drawSettings();
}
function openSettings(i) {
  exMenu = EXM[i];
  ui.exEdit = false;
  ui.exRead = new Set();
  if (IS991) {
    // FT-991A: one list, 001-153, under the meter; the first item selected
    const all = { name: 'MENU', key: '', items: exMenu.groups.flatMap((g) => g.items) };
    exMenu = { name: 'MENU', groups: [all] };
  }
  $('#exmTitle').textContent = exMenu.name;
  $('#exm').hidden = false;
  openExGroup(exMenu.groups[0]);
  if (IS991) exMove(0);
}
function closeSettings() { exFlush(); ui.exEdit = false; $('#exm').hidden = true; exMenu = exGroup = exSel = null; render(); }
// FT-991A menu: select the item n rows on, keep it in view, read the values around it
function exMove(n) {
  const items = exGroup.items;
  const i = clamp((exSel ? items.indexOf(exSel.it) : 0) + n, 0, items.length - 1);
  exSel = { it: items[i], key: exGroup.key + items[i].p };
  $(`#exmItems [data-key="${exSel.key}"]`)?.scrollIntoView({ block: 'nearest' });
  for (let j = Math.max(0, i - 1); j <= Math.min(items.length - 1, i + 3); j++) {
    const k = exGroup.key + items[j].p;
    if (items[j].t !== 'na' && radio.connected && !ui.exRead.has(k)) { ui.exRead.add(k); radio.send(`EX${k};`, { read: true }); }
  }
  drawSettings();
}
function openExGroup(g) {
  exGroup = g; exSel = null;
  const gl = $('#exmGroups');
  gl.innerHTML = '';
  exMenu.groups.forEach((x) => {
    const b = document.createElement('button');
    b.className = `exm-g${x === g ? ' cur' : ''}`;
    b.textContent = x.name;
    b.addEventListener('click', () => openExGroup(x));
    gl.appendChild(b);
  });
  const il = $('#exmItems');
  il.innerHTML = '';
  il.scrollTop = 0;
  g.items.forEach((it) => {
    const key = g.key + it.p;
    const row = document.createElement('div');
    row.className = `exm-i${it.t === 'na' ? ' na' : ''}`;
    row.innerHTML = '<span class="n"></span><button class="v"></button>';
    row.firstChild.textContent = IS991 ? `${it.p} ${it.name}` : it.name;
    row.dataset.key = key;
    const pick = () => { if (it.t === 'na') { toast(`${it.name} は CAT では操作できません`); return false; } exSel = { it, key }; drawSettings(); return true; };
    row.addEventListener('click', () => { if (IS991) exMove(g.items.indexOf(it) - g.items.indexOf(exSel?.it ?? g.items[0])); else pick(); });
    row.lastChild.addEventListener('click', (e) => {
      e.stopPropagation();
      // (FT-991A: a click only selects; values change with SELECT + MULTI / wheel, as on the radio)
      if (IS991) { exMove(g.items.indexOf(it) - g.items.indexOf(exSel?.it ?? g.items[0])); return; }
      if (!pick()) return;
      if (it.t === 'text') {
        const t = prompt(`${it.name}（最大 ${it.n} 文字）`, (s.ex[key] || '').trim());
        if (t != null && t.slice(0, it.n) !== (s.ex[key] || '').trim()) radio.setEx(key, t.slice(0, it.n));
      } else exAdjust(e.shiftKey ? -1 : 1);
    });
    // FT-991A: the wheel scrolls through the items (as MULTI); the value changes only while SELECT is on (handled on the list)
    if (!IS991) row.addEventListener('wheel', (e) => { e.preventDefault(); const n = wheelNotch(e, exWheel); if (n && pick()) exAdjust(n); }, { passive: false });
    il.appendChild(row);
    // (FT-991A: the 153 items are read as they come into view)
    if (!IS991 && it.t !== 'na' && radio.connected) radio.send(`EX${key};`, { read: true });
  });
  drawSettings();
}
function drawSettings() {
  if (!exGroup) return;
  for (const row of $('#exmItems').children) {
    const it = exGroup.items.find((x) => exGroup.key + x.p === row.dataset.key);
    setText(row.lastChild, radio.connected ? exText(it, s.ex[row.dataset.key]) : '—');
    row.classList.toggle('sel', exSel?.key === row.dataset.key);
    row.classList.toggle('edit', !!ui.exEdit && exSel?.key === row.dataset.key);
  }
  if ($('#exmSel')) setText($('#exmSel'), ui.exEdit ? 'ENTER' : 'SELECT');
  // reset the selected item to its factory default (only items whose default the manuals print)
  const def = exSel && EXD[exSel.key];
  const b = $('#exmDef');
  b.hidden = !exSel;
  b.disabled = def == null || !radio.connected || s.ex[exSel?.key] === def;
  setText(b, def == null ? '初期値 不明' : `初期値に戻す（${exText(exSel.it, def)}）`);
}

// ---------------- side panel VFO keys (app functions not on the radio's FUNC pages) ----------------
function setupVfoKeys() {
  const acts = { lock: () => radio.setLock(!s.lock), dual: () => radio.setDual(!s.dual), atob: () => radio.copyAtoB(), btoa: () => radio.copyBtoA(), step: () => ACTIONS.step() };
  // (the side panel's keys only: the bands on the screen carry data-vfo too)
  document.querySelectorAll('#secVfo [data-vfo]').forEach((b) => b.addEventListener('click', () => { acts[b.dataset.vfo](); render(); }));
  // the FT-991A has one receiver
  document.querySelector('[data-vfo="dual"]').hidden = IS991;
  setInterval(() => {
    document.querySelector('[data-vfo="lock"]').classList.toggle('on', s.lock);
    document.querySelector('[data-vfo="dual"]').classList.toggle('on', s.dual);
    document.querySelector('[data-vfo="step"]').textContent = `STEP ${cfg.step === 'auto' ? 'AUTO' : stepText(cfg.step)}`;
  }, 300);
}

// ---------------- FT8 (receive on RX audio, transmit on TX audio) ----------------
function setupFt8() {
  const ft8 = new Ft8Decoder();
  ft8.setMode(cfg.ft8Mode);
  // slot length (ms) and, per protocol, how late a transmission may still start / switch message, and when it must end
  const SL = () => ft8.slot;
  const TXT = () => (ft8.ft4 ? { late: 1000, restart: 1200, end: 7000 } : { late: 2000, restart: 2500, end: 14000 });
  const list = $('#ft8List');
  const strip = (c) => (c || '').replace(/[<>]/g, '');
  const isGrid = (x) => /^[A-R]{2}\d{2}$/.test(x) && x !== 'RR73';
  const fmtRpt = (db) => { const v = clamp(Math.round(db), -30, 49); return `${v < 0 ? '-' : '+'}${String(Math.abs(v)).padStart(2, '0')}`; };
  const utcOf = (slot) => new Date(slot * SL()).toISOString().slice(11, 19).replace(/:/g, '');
  const toMe = (text) => !!cfg.ft8My && strip(text.split(' ')[0]) === cfg.ft8My;
  let rows = [];
  const draw = () => {
    const shown = cfg.ft8Cq ? rows.filter((r) => r.tx || /^CQ\b/.test(r.text) || toMe(r.text)) : rows;
    // (the list is rebuilt: keep where it was scrolled to)
    const top = list.scrollTop;
    list.innerHTML = '';
    let lastUtc = null;
    for (const r of shown) {
      const el = document.createElement('div');
      el.className = `ft8-row${r.tx ? ' tx' : toMe(r.text) ? ' me' : /^CQ\b/.test(r.text) ? ' cq' : ''}${r.utc !== lastUtc ? ' first' : ''}`;
      lastUtc = r.utc;
      const cells = r.tx ? [r.utc, 'TX', '', r.freq, r.text] : [r.utc, r.snr > 0 ? `+${r.snr}` : r.snr, r.dt.toFixed(1), r.freq, r.text];
      for (const t of cells) {
        const c = document.createElement('span'); c.textContent = t; el.appendChild(c);
      }
      if (!r.tx) {
        // click: answer this station (DX call, report, the other period); double-click also turns TX on
        el.addEventListener('click', () => pick(r));
        el.addEventListener('dblclick', () => { pick(r); tx.on = true; drawTx(); });
      }
      list.appendChild(el);
    }
    list.scrollTop = top;
  };
  // the RX list reaches down to the window's bottom (above the status bar), at least 190 px; the TX panel beside it takes
  // the same height. Follows the window size (and the page's layout: the deck sits under the radio's face).
  const fitList = () => {
    const panel = $('#panelFt8');
    if (panel.hidden) return;
    const top = list.getBoundingClientRect().top + window.scrollY;
    const below = panel.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
    const h = Math.max(190, Math.floor(window.innerHeight - $('#statusbar').offsetHeight - 14 - top - below));
    if (list.style.minHeight !== `${h}px`) list.style.minHeight = `${h}px`;
  };
  window.addEventListener('resize', fitList);
  new ResizeObserver(fitList).observe($('#radio'));
  ui.ft8Fit = fitList;
  const addRows = (more) => { rows = [...more, ...rows].sort((a, b) => b.slot - a.slot).slice(0, 300); draw(); }; // newest slot on top
  ft8.addEventListener('decoded', (e) => {
    $('#ft8Info').textContent = `${e.detail.utc} · ${e.detail.rows.length} 件`;
    addRows(e.detail.rows);
    autoSeq(e.detail);
  });
  let pending = null;
  const sync = async () => {
    const rx = audio.rx;
    if (!cfg.ft8 || !rx) { pending = null; ft8.stop(); return; }
    if (ft8.ctx === rx.ctx || pending === rx.ctx) return;
    pending = rx.ctx;
    try { await ft8.start(rx.ctx, rx.src); } catch (err) { toast(`FT8 デコーダ開始失敗: ${err.message}`, true); }
    if (pending === rx.ctx) pending = null;
  };
  audio.addEventListener('state', sync);
  ft8.addEventListener('state', () => $('#btnFt8').classList.toggle('on', ft8.active));
  $('#btnFt8').classList.toggle('on', cfg.ft8);
  $('#btnFt8').addEventListener('click', () => {
    cfg.ft8 = !cfg.ft8; save();
    $('#btnFt8').classList.toggle('on', cfg.ft8);
    if (cfg.ft8 && !audio.rx) startRxAudio();
    sync();
  });
  $('#btnFt8Clr').addEventListener('click', () => { rows = []; draw(); });
  $('#ft8Cq').checked = cfg.ft8Cq;
  $('#ft8Cq').addEventListener('change', (e) => { cfg.ft8Cq = e.target.checked; save(); draw(); });
  setInterval(() => { $('#ft8Bar').style.width = `${(ft8.secInSlot * 1000 / SL()) * 100}%`; }, 200);
  sync();

  // ---- transmit ----
  // Tx1-Tx6 as in WSJT-X: 1 call with grid, 2 report, 3 R+report, 4 RR73, 5 73, 6 CQ.
  // The period is the slot parity: 0 = :00/:30, 1 = :15/:45. A transmission keys PTT at the slot start and plays the
  // GFSK audio from 0.5 s (WSJT-X's DT = 0); PTT drops when the audio has played (12.64 s).
  const tx = { dx: '', rpt: '-10', sel: 5, msgs: [], on: false, cur: null, lastSlot: -1, lastText: '', repeat: 0 };
  const WATCHDOG = 10; // the same message this many times in a row turns TX off (as WSJT-X's Tx watchdog)
  const msgEls = $$('#ft8Msgs input[type=text]'), selEls = $$('#ft8Msgs input[type=radio]');
  const gen = () => {
    const my = cfg.ft8My, dx = tx.dx, g = cfg.ft8Grid.slice(0, 4), r = tx.rpt;
    tx.msgs = [`${dx} ${my} ${g}`, `${dx} ${my} ${r}`, `${dx} ${my} R${r}`, `${dx} ${my} RR73`, `${dx} ${my} 73`, `CQ ${my} ${g}`]
      .map((m) => m.replace(/\s+/g, ' ').trim());
    msgEls.forEach((el, i) => { el.value = tx.msgs[i]; });
  };
  const drawTx = () => {
    selEls.forEach((el, i) => { el.checked = tx.sel === i; });
    msgEls.forEach((el, i) => el.parentElement.classList.toggle('sending', tx.cur?.sel === i));
    $('#ft8Dx').value = tx.dx;
    $('#ft8Rpt').value = tx.rpt;
    $('#btnFt8Tx').classList.toggle('on', tx.on);
    $('#btnFt8Per').textContent = ft8.ft4 ? (cfg.ft8Per ? '07/22' : '00/15') : (cfg.ft8Per ? '15/45' : '00/30');
    $('#ft8TxTag').hidden = !tx.cur;
  };
  // the station a decoded message comes from (for CQ: the call before the grid), and its grid
  const sender = (text) => {
    const t = text.split(' ');
    if (t[0] === 'CQ') { const g = isGrid(t[t.length - 1]); return { call: strip(t[t.length - (g ? 2 : 1)]), grid: g }; }
    return { call: strip(t[1]), grid: isGrid(t[2] || '') };
  };
  // which Tx answers a message addressed to us: -1 = QSO over, null = not for us / not from our DX
  const answer = (text) => {
    const t = text.split(' ');
    if (strip(t[0]) !== cfg.ft8My || !t[1]) return null;
    const x = t[2] || '';
    // another station: only a fresh call (grid or report) while we call CQ
    if (strip(t[1]) !== tx.dx && (tx.sel !== 5 || !(x === '' || isGrid(x) || /^[+-]\d\d$/.test(x)))) return null;
    if (x === 'RR73' || x === 'RRR') return 4;
    if (x === '73') return -1;
    if (/^R[+-]\d\d$/.test(x)) return 3;
    if (/^[+-]\d\d$/.test(x)) return 2;
    return 1;
  };
  const respond = (r) => {
    const n = answer(r.text);
    if (n === null) return false;
    if (strip(r.text.split(' ')[1]) !== tx.dx) { tx.dx = strip(r.text.split(' ')[1]); tx.rpt = fmtRpt(r.snr); gen(); }
    if (n < 0) { tx.on = false; toast(`${tx.dx} との QSO 終了`); } else tx.sel = n;
    return true;
  };
  const pick = (r) => {
    const { call } = sender(r.text);
    if (!call || call === cfg.ft8My) return;
    cfg.ft8Per = 1 - (r.slot % 2); save();
    if (call !== tx.dx) { tx.dx = call; tx.rpt = fmtRpt(r.snr); }
    gen();
    if (!respond(r)) tx.sel = 0;
    drawTx();
  };
  const autoSeq = ({ slot, rows: got }) => {
    if (!cfg.ft8Auto || !tx.on || slot % 2 === cfg.ft8Per) return;
    // a reply from our DX first, else (while calling CQ) the first station that answers
    const mine = got.filter((r) => answer(r.text) !== null);
    const r = mine.find((x) => strip(x.text.split(' ')[1]) === tx.dx) || mine[0];
    if (!r) return;
    const before = tx.msgs[tx.sel];
    respond(r);
    drawTx();
    // decoding ends after our slot has begun: switch the message if the transmission is still young (WSJT-X does too)
    if (tx.cur && tx.on && tx.msgs[tx.sel] !== before && Date.now() % SL() < TXT().restart) restart();
  };

  const problem = () => {
    if (!radio.connected) return 'CATが接続されていません';
    if (!/^[A-Z0-9/]{3,11}$/.test(cfg.ft8My)) return 'FT8: MY CALL を入力してください';
    if (s.mode[s.ft] !== 'C') return 'FT8 送信は DATA-U で行ってください';
    return null;
  };
  const play = (cur, tones) => {
    const ctx = audio.tx.ctx;
    const at = Math.max(cur.slot * SL() + 500, Date.now() + 50);
    const when = ctx.currentTime + (at - Date.now()) / 1000 - (ctx.outputLatency || ctx.baseLatency || 0);
    const p = audio.playWave(ft8Wave(tones, +cfg.ft8TxHz, ctx.sampleRate, +cfg.ft8Lvl, ft8.ft4), when);
    cur.play = p;
    p.done.then(() => { if (cur.play === p) setTimeout(() => end(cur), 100); });
  };
  const encode = async (msg) => {
    const enc = await ft8.encode(msg);
    if (enc.rc) { tx.on = false; toast(`FT8: 送信できないメッセージです: ${msg}`, true); drawTx(); return null; }
    return enc;
  };
  const echo = (cur) => {
    rows = rows.filter((r) => !(r.tx && r.slot === cur.slot));
    addRows([{ tx: true, slot: cur.slot, utc: utcOf(cur.slot), freq: +cfg.ft8TxHz, text: cur.text }]);
  };
  async function begin(slot) {
    const err = problem();
    if (err) { tx.on = false; toast(err, true); drawTx(); return; }
    if (!audio.tx && !(await startTxAudio())) { tx.on = false; drawTx(); return; }
    const sel = tx.sel, enc = await encode(tx.msgs[sel]);
    if (!enc || !tx.on || Math.floor(Date.now() / SL()) !== slot) return;
    const cur = { slot, sel, text: enc.text, play: null };
    tx.cur = cur;
    ft8.txSlot = slot;
    // safety: never past the slot, whatever happens to the audio
    cur.timer = setTimeout(() => end(cur), slot * SL() + TXT().end - Date.now());
    await setPtt(true);
    if (!ui.ptt) { end(cur); return; }
    try { play(cur, enc.tones); } catch (e) { tx.on = false; end(cur, true); toast(`FT8 送信失敗: ${e.message}`, true); return; }
    echo(cur);
    drawTx();
  }
  async function restart() {
    const cur = tx.cur, sel = tx.sel, enc = await encode(tx.msgs[sel]);
    if (!enc || tx.cur !== cur) return;
    cur.play?.stop();
    Object.assign(cur, { sel, text: enc.text });
    try { play(cur, enc.tones); } catch (e) { tx.on = false; end(cur, true); toast(`FT8 送信失敗: ${e.message}`, true); return; }
    echo(cur);
    drawTx();
  }
  function end(cur = tx.cur, halt = false) {
    if (!cur || tx.cur !== cur) return;
    tx.cur = null;
    clearTimeout(cur.timer);
    const p = cur.play; cur.play = null; p?.stop();
    setPtt(false);
    if (!halt) {
      tx.repeat = cur.text === tx.lastText ? tx.repeat + 1 : 1;
      tx.lastText = cur.text;
      if (cfg.ft8Auto && cur.sel === 4) tx.on = false; // 73 sent: done
      if (tx.repeat >= WATCHDOG && tx.on) { tx.on = false; tx.repeat = 0; toast(`FT8: 同じメッセージを ${WATCHDOG} 回送信したので TX を止めました`, true); }
    }
    drawTx();
  }
  ui.ft8Busy = () => !!tx.cur;
  // PTT dropped from outside (PTT key, TOT, window hidden): stop, and do not start again by itself
  ui.ft8Halt = () => { if (tx.cur) { tx.on = false; end(tx.cur, true); } };
  // timers are throttled in a hidden window, so the slot timing could not be kept
  document.addEventListener('visibilitychange', () => { if (document.hidden && tx.on) { tx.on = false; drawTx(); } });
  setInterval(() => {
    const now = Date.now(), slot = Math.floor(now / SL());
    if (!tx.on || tx.cur || tx.lastSlot === slot || slot % 2 !== cfg.ft8Per || now % SL() > TXT().late) return;
    tx.lastSlot = slot;
    begin(slot);
  }, 100);

  const bindTxt = (id, key, re) => {
    const el = $(`#${id}`);
    el.value = cfg[key];
    el.addEventListener('input', () => { cfg[key] = el.value.toUpperCase().replace(re, ''); save(); gen(); });
    el.addEventListener('change', () => { el.value = cfg[key]; });
  };
  bindTxt('ft8My', 'ft8My', /[^A-Z0-9/]/g);
  bindTxt('ft8Grid', 'ft8Grid', /[^A-Z0-9]/g);
  $('#ft8Dx').addEventListener('input', (e) => { tx.dx = e.target.value.toUpperCase().replace(/[^A-Z0-9/]/g, ''); gen(); });
  $('#ft8Rpt').addEventListener('input', (e) => { tx.rpt = e.target.value.trim(); gen(); });
  $('#ft8Dx').addEventListener('change', drawTx);
  $('#ft8TxHz').value = cfg.ft8TxHz;
  $('#ft8TxHz').addEventListener('change', (e) => { cfg.ft8TxHz = clamp(Math.round(+e.target.value || 1500), 200, 3000); e.target.value = cfg.ft8TxHz; save(); });
  $('#ft8Lvl').value = cfg.ft8Lvl;
  $('#ft8Lvl').addEventListener('input', (e) => { cfg.ft8Lvl = +e.target.value; save(); });
  $('#ft8Auto').checked = cfg.ft8Auto;
  $('#ft8Auto').addEventListener('change', (e) => { cfg.ft8Auto = e.target.checked; save(); });
  msgEls.forEach((el, i) => el.addEventListener('input', () => { tx.msgs[i] = el.value.toUpperCase(); }));
  selEls.forEach((el, i) => el.addEventListener('change', () => { tx.sel = i; drawTx(); }));
  $('#btnFt8Tx').addEventListener('click', () => {
    tx.on = !tx.on;
    if (tx.on) { const err = problem(); if (err) { tx.on = false; toast(err, true); } else tx.repeat = 0; }
    drawTx();
  });
  $('#btnFt8Halt').addEventListener('click', () => { tx.on = false; end(tx.cur, true); drawTx(); });
  $('#btnFt8Per').addEventListener('click', () => { cfg.ft8Per = 1 - cfg.ft8Per; save(); drawTx(); });
  // FT8 / FT4: TX stops, the list starts over (slot numbers differ)
  const drawMode = () => {
    for (const el of document.querySelectorAll('.ft8-title')) el.textContent = ft8.mode;
    $('#btnFt8Mode').textContent = ft8.mode;
  };
  $('#btnFt8Mode').addEventListener('click', () => {
    tx.on = false; end(tx.cur, true);
    cfg.ft8Mode = ft8.mode === 'FT8' ? 'FT4' : 'FT8'; save();
    ft8.setMode(cfg.ft8Mode);
    rows = []; draw(); $('#ft8Info').textContent = '--';
    tx.lastSlot = -1; tx.repeat = 0;
    drawMode(); drawTx();
  });
  drawMode();
  gen();
  drawTx();
}

// ---------------- right sidebar (USB AUDIO / SETUP) ----------------
function setupSidebar() {
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

// FT-991A screen icons (manual p.22 各種アイコン表示) and its own parts of the face
function statusHtml991() {
  // each icon at its own place (manual p.22, product photo): row 1 TUNER / ATT / SPLIT (and the repeater shift),
  // row 2 the preamp (IPO / AMP1 / AMP2) / VOX / tone (ENC, DEC, DCS); x, y in cqi of the screen
  const pre = ['IPO', 'AMP1', 'AMP2'][preampVal(0)] || 'IPO';
  const tone = ['', 'DEC', 'ENC', 'DCS', 'DCS'][s.ct[0]] || '';
  const items = [
    s.tuner && ['TUNER', 'red', 0.35, 1.1],
    s.att && ['ATT', '', 13.7, 1.3],
    isSplit() && ['SPLIT', '', 20.4, 1.3],
    s.os[0] === 1 && ['+', '', 29.5, 1.3], s.os[0] === 2 && ['−', '', 29.5, 1.3],
    [pre, '', 0.6, 4.9],
    s.vox && ['VOX', '', 10.2, 4.9],
    tone && [tone, '', 20.4, 4.9],
  ].filter(Boolean);
  return items.map(([t, c, x, y]) => `<span class="si ${c}" style="left:${x}cqi;top:${y}cqi">${t}</span>`).join('');
}
function drawFace991(conn) {
  const lcdCls = `lcd lcd991${conn ? (s.synced ? '' : ' nosync') : ' off'}`;
  const lcd = $('#lcd');
  if (lcd.className !== lcdCls) { lcd.className = lcdCls; requestAnimationFrame(fitFreq); }
  const st = statusHtml991();
  if ($('#stBar').innerHTML !== st) $('#stBar').innerHTML = st;
  $('#t9Hiswr').classList.toggle('on', (s.tx && s.meters[6] > 126) || !!s.ri?.hiswr);
  // the bar under the frequency: the value of the MULTI knob's function
  $('#t9Lvl').style.width = `${clamp(paramFrac(cfg.func), 0, 1) * 100}%`;
  // operating mode display (IF P7): VFO-A / MEM / MT / QMB / PMS / HOME
  const vm = s.vm[0];
  // "VFO-" small and "A" large, as on the screen
  const vfoTxt = ['VFO-<b>A</b>', 'MEM', 'MT', 'QMB', 'QMB', 'PMS', 'HOME'][vm.t] || 'VFO-<b>A</b>';
  if ($('#t9Vfo').innerHTML !== vfoTxt) $('#t9Vfo').innerHTML = vfoTxt;
  setText($('#t9Ch'), vm.t === 1 || vm.t === 2 ? `CH ${String(+vm.ch || 0).padStart(3, '0')}` : '');
  for (let v = 0; v < 2; v++) {
    const mb = $(`#band${v}`).querySelector('.b-mode'), mn = MODE_NAME[s.mode[v]] || '---';
    mb.textContent = mn;
    mb.classList.toggle('long', mn.length > 6); // (DATA-LSB, DATA-USB, C4FM-DN: set narrower to stay in the box)
    const html = freqHtml(s.freq[v]);
    if (html !== lastFreqHtml[v]) { $(`#freq${v}`).innerHTML = html; lastFreqHtml[v] = html; fitFreq(); }
    $(`#freq${v}`).classList.toggle('tx', (s.tx || ui.ptt) && s.ft === v);
  }
  // with the clarifier on, the VFO-B line shows CLAR and its offset (manual p.19, 22)
  const clarOn = s.clarRx[0] || s.clarTx[0];
  $('#band1').classList.toggle('clar', clarOn);
  setText($('#t9ClarTag'), s.clarRx[0] && s.clarTx[0] ? 'CLAR RX/TX' : s.clarTx[0] ? 'CLAR TX' : 'CLAR');
  const ofs = `${s.clarOfs[0] > 0 ? '+' : ''}${s.clarOfs[0]}<small>Hz</small>`;
  if ($('#t9ClarOfs').innerHTML !== ofs) $('#t9ClarOfs').innerHTML = ofs;
  const d = new Date();
  setText($('#t9Clock'), `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  for (const { k, kind } of afKnobs) {
    if (!k.active) k.setFraction(kind === 'af' && cfg.spkMute ? cfg.rxVol / 2 : (kind === 'af' ? s.af[0] : s.rf[0]) / 255);
  }
  // keys with a state, and the LED strip above the dial: RX (green, signal above squelch) / TX (red), FAST, LOCK
  $('[data-act="split991"]').classList.toggle('on', isSplit());
  $('[data-act="clar991"]').classList.toggle('on', clarOn);
  $('[data-act="tune991"]').classList.toggle('on', s.tuner);
  $('[data-act="txw"]').classList.toggle('on', s.txw);
  const busy = conn && !s.tx && s.ri?.busy;
  $('#led9Rx').classList.toggle('on', !!busy);
  $('#led9Tx').classList.toggle('on', conn && (s.tx || ui.ptt));
  $('#led9Fast').classList.toggle('on', conn && s.fn === 2);
  $('#led9Lock').classList.toggle('on', conn && s.lock);
  // VFO lamps: green under the receiving one (MEM in memory mode, else VFO-A), red under the transmitting one
  const mem = vm.t === 1 || vm.t === 2;
  for (const [id, rx, tx] of [['#led9Mem', mem, mem && s.ft === 0], ['#led9A', !mem, !mem && s.ft === 0], ['#led9B', false, s.ft === 1]]) {
    $(id).classList.toggle('rx', conn && rx);
    $(id).classList.toggle('tx', conn && tx);
  }
}

function draw() {
  const conn = radio.connected;
  $('#btnConnect').classList.toggle('on', conn);
  if (IS991) drawFace991(conn); else drawFaceFtx1(conn);
  drawStatusbar();
  $('#funcBox').textContent = funcName();

  drawMeters();
  drawFilters();
  updatePop();
  for (const sk of softKeys) {
    sk.b.textContent = val(sk.k.name);
    sk.span.textContent = sk.k.key();
    sk.el.classList.toggle('open', (!!sk.k.pop && ui.pop === sk.k.pop) || (!!sk.k.func && cfg.func === sk.k.func));
  }
  $('#scope').style.visibility = cfg.afFft ? '' : 'hidden';
  drawCommon(conn);
}

function drawFaceFtx1(conn) {
  const lcd = $('#lcd');
  // dark while POWER is off; connected but before the radio has sent its frequency, the keys show and the values stay
  // blank (not the placeholders such as 14.200)
  const lcdCls = `lcd lay-${cfg.layout}${cfg.layout === 'single' && s.vs === 1 ? ' only-sub' : ''}${conn ? (s.synced ? '' : ' nosync') : ' off'}`;
  if (lcd.className !== lcdCls) { lcd.className = lcdCls; requestAnimationFrame(fitFreq); }

  const st = statusHtml();
  if ($('#stBar').innerHTML !== st) $('#stBar').innerHTML = st;

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

  for (const { k, v } of afKnobs) {
    const kind = knobMode(v);
    if (!k.active) k.setFraction(kind === 'af' && cfg.spkMute ? cfg.rxVol / 2 : (kind === 'af' ? s.af[v] : kind === 'rf' ? s.rf[v] : s.sql[v]) / 255);
    $(`#knAF${v}mode`).textContent = kind.toUpperCase();
    for (const el of $(`#knAF${v}`).parentElement.querySelectorAll('.kn')) el.classList.toggle('on', el.dataset.k === kind);
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
  // the radio's scope settings line (e.g. "CENTER FAST2 SPAN 100kHz")
  $('#scInfo').textContent = `${SC_DMODE[scopeDmode()]} ${SC_SPEED[+s.scope[0]] || ''} SPAN ${(SC_SPAN[s.scope[5]] || '').replace('k', 'kHz').replace('M', 'MHz')}`;
}

// PTT key, PC squelch, the PC deck's panels
function drawCommon(conn) {
  // FT-991A: in the DATA modes (DATA-LSB / DATA-USB / DATA-FM) the AF-FFT shows 0-3 kHz, else the AF-FFT span setting
  const span = IS991 && ['8', 'C', 'A'].includes(s.mode[0]) ? 3000 : +cfg.scopeSpan;
  if (scope.span !== span) scope.span = span;
  $('#btnPtt').classList.toggle('on', s.tx || ui.ptt);
  // PC playback follows the radio's squelch, in the FM modes only (where the knob is SQL, as RF/SQL VR = AUTO; elsewhere
  // it is RF and SQL could not be turned down): MAIN from RI (SQL open / closed, sent by the radio as it changes), SUB
  // estimated from its S meter against SQL (as the SUB BUSY lamp); SQL at 0 is always open
  {
    const on = (v) => cfg.pcSql && conn && !s.tx && isFM(s.mode[v]) && s.sql[v] > 0;
    // (FT-991A: its USB audio carries the transmitted audio back while transmitting; not played on the PC, except the CW sidetone)
    const txEcho = IS991 && s.tx && !isCW(s.mode[0]);
    const mainOpen = !txEcho && (!on(0) || (s.ri ? s.ri.busy : true));
    const subOpen = !txEcho && (!on(1) || s.smeter[1] > Math.max(12, s.sql[1] / 2));
    audio.setRxSquelch(mainOpen, subOpen);
  }
  // CW TX / RX panels only while the operated VFO is in CW
  const cw = isCW(s.mode[V()]);
  $('#panelCw').hidden = !cw;
  $('#panelDec').hidden = !cw;
  const data = ['C', '8'].includes(s.mode[V()]);
  if ($('#panelFt8').hidden === data) { $('#panelFt8').hidden = !data; $('#panelFt8Tx').hidden = !data; if (data) requestAnimationFrame(() => ui.ft8Fit?.()); }
  $('#cwWpm').textContent = s.ks;
  if (!ui.cwSpeedDrag) $('#cwSpeed').value = s.ks;
  $('#catErr').textContent = `ERR ${s.errors}`;
  $('#catErr').classList.toggle('err', s.errors > 0);
}

radio.addEventListener('change', () => {
  if (exGroup) drawSettings();
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
setupVfoKeys();
$('#exmBack').addEventListener('click', closeSettings);
// FT-991A menu: the wheel over the list moves the selection (down = next item), or changes the value after SELECT
if (IS991) $('#exmItems').addEventListener('wheel', (e) => {
  e.preventDefault();
  const n0 = wheelNotch(e, exWheel);
  if (!n0 || !exSel) return;
  const n = wheelAccel(n0, exWheel);
  if (ui.exEdit) exAdjust(n); else exMove(-n);
}, { passive: false });
// FT-991A menu: SELECT starts changing the selected item's value, ENTER (the same key) ends it
$('#exmSel')?.addEventListener('click', () => {
  if (!exSel) return;
  const { it, key } = exSel;
  if (it.t === 'na') { toast(`${it.name} は CAT では操作できません`); return; }
  if (it.t === 'text') {
    const t = prompt(`${it.name}（最大 ${it.n} 文字）`, (s.ex[key] || '').trim());
    if (t != null && t.slice(0, it.n) !== (s.ex[key] || '').trim()) radio.setEx(key, t.slice(0, it.n));
    return;
  }
  ui.exEdit = !ui.exEdit;
  if (!ui.exEdit) exFlush();
  drawSettings();
});
$('#exmDef').addEventListener('click', () => {
  const def = exSel && EXD[exSel.key];
  if (def == null) return;
  sendEx(exSel.key, def);
  drawSettings();
});
setupDecoder();
setupFt8();
render();

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
// SETUP: install (in the browser) / uninstall (in the installed app). A page cannot uninstall itself, so the
// installed app's button explains Chrome's own menu.
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
{
  const inApp = standalone();
  $('#btnAppInst').textContent = inApp ? 'アンインストール' : 'インストール';
  $('#appInstHint').textContent = inApp ? 'アプリとして起動中' : 'ブラウザで表示中';
  $('#btnAppInst').addEventListener('click', async () => {
    if (inApp) { toast('ウインドウ右上の ⋮ →「FTX-1 Controller をアンインストール」を選んでください（機種を FT-991A にしていても名前は同じです）', false, 8000); return; }
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; return; }
    toast('Chrome のメニュー（右上の ⋮）→「キャスト、保存、共有」→「ページをアプリとしてインストール」から入れてください', false, 8000);
  });
}
// Installed app: fit the window to the panel on every launch (the side panel starts closed, so the content is the
// field head + status bar): width = the field head's maximum width, height = what the page then needs.
if (standalone()) {
  const fit = () => {
    const chromeW = window.outerWidth - window.innerWidth, chromeH = window.outerHeight - window.innerHeight;
    const body = getComputedStyle(document.body);
    const contentW = 1320 + parseFloat(body.paddingLeft) + parseFloat(body.paddingRight);
    const w = Math.min(screen.availWidth, contentW + chromeW);
    window.resizeTo(w, Math.min(screen.availHeight, window.outerHeight));
    // wait for the relayout at the new width, then take the height the page needs
    setTimeout(() => {
      // body has min-height: 100vh, so scrollHeight is never smaller than the window: measure the content instead
      const bottom = $('#app').getBoundingClientRect().bottom + window.scrollY;
      const h = Math.min(screen.availHeight, Math.ceil(bottom + 12 + $('#statusbar').offsetHeight + chromeH));
      window.resizeTo(w, h);
      window.moveTo(Math.max(0, (screen.availWidth - w) / 2), Math.max(0, (screen.availHeight - h) / 2));
    }, 150);
  };
  if (document.readyState === 'complete') fit(); else window.addEventListener('load', fit, { once: true });
  // CW panels / CAT CONSOLE shown or hidden later: grow or shrink the window height with the content
  let lastBottom = 0;
  new ResizeObserver(() => {
    const bottom = Math.ceil($('#app').getBoundingClientRect().bottom + window.scrollY);
    if (!lastBottom) { lastBottom = bottom; return; }
    if (bottom === lastBottom) return;
    lastBottom = bottom;
    const chromeH = window.outerHeight - window.innerHeight;
    const room = screen.availHeight - Math.max(0, window.screenY - (screen.availTop || 0));
    window.resizeTo(window.outerWidth, Math.min(room, bottom + 12 + $('#statusbar').offsetHeight + chromeH));
  }).observe($('#app'));
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {});
}

// debug handle for the DevTools console, e.g. ftx.s.smeter[0] = 160
window.ftx = { radio, s, audio, cfg, ui };
