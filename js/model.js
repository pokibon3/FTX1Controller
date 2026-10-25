// Which radio this page drives, chosen in SETUP (saved with the other settings; changing it reloads the page).
// Read before anything else so the CAT tables, the radio's face and the setting menus are built for that radio.
export const MODEL = (() => {
  try { return JSON.parse(localStorage.getItem('ftx1.cfg') || '{}').model === 'ft991a' ? 'ft991a' : 'ftx1'; } catch { return 'ftx1'; }
})();
export const IS991 = MODEL === 'ft991a';
export const MODEL_NAME = IS991 ? 'FT-991A' : 'FTX-1';
