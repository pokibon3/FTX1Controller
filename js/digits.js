// Frequency digits of the FTX-1 TFT, traced from the operation manuals' screen pictures (not drawn by eye).
// 17 readings in the basic manual (7.060.000, 7.060.020, 7.000.000, 145.000.000, 145.120.000, 432.500.000,
// 14.195.000 and the SHIFT/WIDTH/NOTCH/CONTOUR/APF figures) were cut into single characters, unslanted with
// their measured slant, scaled to one height and averaged per digit (0: 52 samples, 1/7: 8, 2/6: 7, 4: 5, 5: 4,
// 3: 3, 8/9: 1 each); the outlines are the 50% contours of those averages (lightly blurred), with
// edges within 14 deg of horizontal/vertical snapped straight: the figures are built from straight strokes.
// Glyph box: 194 x 200 units = one digit pitch (0.97 x the digit height); the slant is applied in CSS.
// Each glyph is used as a CSS mask so the colour comes from CSS (TX red, hover).

const W = 194, H = 200;
const PATHS = {
  0: 'M37.0 -0.0L21.7 13.0L14.8 33.0L14.9 153.0L14.9 173.0L26.0 184.2L47.0 194.1L134.0 194.0L146.0 194.0L161.6 184.0L168.5 175.0L171.9 165.0L171.8 40.0L171.8 19.0L162.3 9.0L150.9 -0.0ZM120.0 37.1L131.2 42.0L131.3 72.0L131.3 148.0L129.0 156.4L119.0 159.2L65.0 159.2L56.1 153.0L56.2 78.0L56.2 46.0L61.0 39.2L69.0 37.1Z',
  1: 'M54.4 -0.0L54.4 19.0L58.4 30.0L63.0 35.1L81.0 35.1L87.6 44.0L87.6 188.0L96.0 195.9L119.0 195.9L126.6 193.0L129.7 185.0L129.7 -0.0Z',
  // 2 and 8: built from the traced family's measurements (outline 15..172 x 0..194, strokes 41 / 37,
  // middle bar 75..112): the 8 had a single tiny sample, the 2's averaged left stroke was misregistered
  2: 'M11 0L152 0L165 8L172 22L172 97L165 109L152 117L62 117L56 123L56 157L172 157L172 194L30 194L18 186L15 174L15 101L22 88L36 80L126 80L131 75L131 42L126 37L24 37L14 30L11 22Z',
  3: 'M14.0 -0.0L14.0 21.0L25.0 30.6L126.0 30.6L131.5 41.0L131.4 62.0L131.4 73.0L122.0 77.9L28.0 77.9L14.4 82.0L14.4 102.0L20.0 112.3L30.0 112.3L124.0 112.3L131.5 120.0L131.5 141.0L131.5 155.0L123.0 160.8L21.0 160.8L16.4 165.0L13.4 171.0L13.4 180.0L15.7 189.0L21.0 194.0L30.0 193.6L137.0 193.5L151.0 193.5L159.0 186.9L166.2 179.0L169.9 167.0L169.8 40.0L169.8 22.0L164.9 11.0L155.9 -0.0Z',
  4: 'M69.0 -0.0L30.9 81.0L19.2 120.0L19.2 157.0L22.0 161.1L28.0 164.6L98.0 164.6L105.1 171.3L105.1 187.0L109.8 193.0L117.0 195.7L133.0 195.7L146.9 192.0L146.9 169.0L165.0 162.4L167.2 155.0L167.2 132.0L151.0 123.1L146.4 116.0L146.4 11.0L146.4 -0.0ZM97.9 40.0L105.1 42.0L105.2 50.0L105.2 117.0L100.0 125.4L70.0 125.4L63.0 123.0L60.9 118.0L89.0 52.0L97.0 40.3Z',
  5: 'M18.5 -0.0L18.6 13.0L18.7 61.0L18.7 111.0L29.0 114.9L120.0 114.9L128.1 119.0L128.0 150.0L122.0 156.6L23.0 156.6L17.8 166.0L17.9 190.0L23.0 194.6L31.0 194.3L134.0 194.2L145.0 194.2L153.8 187.0L162.4 178.0L168.4 165.0L168.3 118.0L168.3 99.0L155.0 84.6L139.0 75.1L65.0 75.1L59.2 66.0L59.2 45.0L62.0 39.9L69.0 36.9L165.0 36.9L169.5 28.0L169.5 -0.0Z',
  6: 'M41.0 -0.0L23.0 13.0L15.7 33.0L15.8 154.0L15.8 172.0L27.2 185.0L48.0 193.9L133.0 193.9L160.0 186.4L170.4 170.0L170.2 143.0L170.2 99.6L155.0 86.4L141.0 77.7L61.0 77.7L58.4 70.0L58.4 45.0L62.2 41.0L68.0 38.6L168.0 38.6L173.3 34.0L173.3 9.0L170.2 -0.0ZM119.0 112.4L129.9 112.4L130.0 124.0L130.0 151.0L124.0 154.8L63.0 154.8L57.6 150.0L57.6 116.0L62.0 112.3Z',
  7: 'M18.0 -0.1L14.5 9.0L14.5 28.0L16.1 33.0L21.0 37.3L115.0 37.3L122.7 41.0L112.8 75.0L59.9 189.0L59.9 193.0L64.0 194.8L90.0 194.8L97.0 192.5L105.9 183.0L172.7 47.0L172.7 5.0L170.9 -0.1L166.0 -0.1Z',
  // 8: point-symmetric (top and bottom loops equal, rotated 180 deg), waist notch on both sides
  8: 'M37 0L151 0L162 9L172 19L172 85L165 97L172 109L172 161L165 181L150 194L36 194L25 185L15 175L15 109L22 97L15 85L15 33L22 13ZM61 37L126 37L131 42L131 74L126 79L61 79L56 74L56 42ZM126 157L61 157L56 152L56 120L61 115L126 115L131 120L131 152Z',
  9: 'M37.0 -0.0L23.7 10.0L13.0 29.0L13.1 78.0L13.1 98.0L28.0 113.6L37.0 119.1L123.0 119.1L130.1 131.0L130.1 151.0L126.8 158.0L117.0 161.8L19.0 161.8L11.8 170.0L11.8 190.0L22.6 199.0L139.9 199.0L157.0 188.9L172.3 167.0L172.3 33.0L167.8 19.0L149.7 -0.0ZM66.0 35.7L112.0 35.7L128.0 40.7L131.1 47.0L131.1 72.0L127.0 78.8L119.6 80.6L71.0 80.5L57.9 80.5L52.5 68.0L52.5 46.0L56.0 40.2L66.0 36.0Z',
};

const uri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const glyph = (d) => uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="#000" fill-rule="evenodd"/></svg>`);
// decimal point: a square of 0.18 x the digit height on the bottom edge, centred in a 0.31-wide box (measured)
const DW = 62, DS = 36;
const DOT = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DW} ${H}"><rect x="${(DW - DS) / 2}" y="${H - DS}" width="${DS}" height="${DS}" rx="3"/></svg>`);

// Adds one mask rule per glyph: <span class="d" data-g="7"> / <span class="dot">
export function installDigitGlyphs() {
  const rules = Object.entries(PATHS).map(([g, d]) => `.freq .d[data-g="${g}"]{--glyph:${glyph(d)}}`);
  rules.push(`.freq .dot{--glyph:${DOT}}`);
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}
