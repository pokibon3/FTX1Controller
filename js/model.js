// Which radio this window drives: ?m=ft991a / ?m=ftx1 in its address, so two windows can drive one each; without it,
// the one chosen last. Changing it (SETUP) reloads the page. Each radio keeps its own settings (CFG_KEY), so two
// windows never write over each other's.
// Read before anything else so the CAT tables, the radio's face and the setting menus are built for that radio.
export const MODEL = (() => {
  const q = new URLSearchParams(location.search).get('m');
  if (q === 'ft991a' || q === 'ftx1') return q;
  try {
    const last = localStorage.getItem('ftx1.model') || JSON.parse(localStorage.getItem('ftx1.cfg') || '{}').model;
    return last === 'ft991a' ? 'ft991a' : 'ftx1';
  } catch { return 'ftx1'; }
})();
export const IS991 = MODEL === 'ft991a';
export const MODEL_NAME = IS991 ? 'FT-991A' : 'FTX-1';
export const CFG_KEY = IS991 ? 'ft991a.cfg' : 'ftx1.cfg';
try { localStorage.setItem('ftx1.model', MODEL); } catch {}
