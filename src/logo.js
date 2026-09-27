/**
 * Marka varliklari: logo (SVG) ve komut satiri armasi (ASCII).
 *
 * Tasarim: mezar tasinin icinde iki kutu ve aralarindaki kirik baglanti —
 * "bagimlilik baglantisi kopmus". Ayni hikaye uc yerde gecer:
 *   - docs/logo.svg        (README, npm sayfasi, favicon)
 *   - `deaddeps --help`    (komut satiri armasi)
 *   - `deaddeps --html`    (raporun basligi)
 *
 * Sifir bagimlilik kurali burada da gecerli: SVG elle yazilmis, ASCII
 * elle hizalanmis, hicbir font/asset indirilmiyor.
 */

import { bold, dim } from './colors.js';

/** docs/logo.svg icinde de birebir bulunan tasi tanimi — test senkrondur. */
export const LOGO_STONE_PATH = 'M34 96V62a30 30 0 0 1 60 0v34z';

/** Mezar tasi + zemin + kirik baglanti (128x128, koyu karo uzerinde). */
export const LOGO_MARKUP = `
  <rect width="128" height="128" rx="28" fill="#161b22"/>
  <rect x="0.75" y="0.75" width="126.5" height="126.5" rx="27.25" fill="none" stroke="#30363d" stroke-width="1.5"/>
  <rect x="24" y="96" width="80" height="14" rx="7" fill="#6e7781"/>
  <path d="${LOGO_STONE_PATH}" fill="#e6edf3" stroke="#c9d1d9" stroke-width="2"/>
  <g fill="none" stroke="#d1242f" stroke-width="4" stroke-linecap="round">
    <rect x="40" y="61" width="16" height="14" rx="4"/>
    <rect x="72" y="61" width="16" height="14" rx="4"/>
    <path d="M56 68h4"/>
    <path d="M72 68h-4"/>
    <path d="M62 66.5 64 64"/>
    <path d="M66 69.5 64 72"/>
  </g>
`.trim();

/**
 * Tam SVG etiketi. Dosya disinda bir yere basmak icin (HTML raporu gibi).
 * Harici kaynak yok: font, script, referans istegi.
 *
 * @param {{width?: number, className?: string}} [opts]
 * @returns {string}
 */
export function logoSvg(opts = {}) {
  const { width = 128, className = '' } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${width}" height="${width}" role="img" aria-label="deaddeps"${className ? ` class="${className}"` : ''}><title>deaddeps</title>${LOGO_MARKUP.replace(/\n\s*/g, '')}</svg>`;
}

/**
 * ASCII armasi — tek tek satir, hizasi elle denetlenmis.
 *
 * Satir uzunluklari farkli (kubbe daralir, zemin genisler); birlestirirken
 * ortak genislige pad edilir, boylece sagdaki metin kolonu duzgun kalir.
 */
export const LOGO_ART = [
  '      ________',
  '    /          \\',
  '   /            \\',
  '  |              |',
  '  |  +--+  +--+  |',
  '  |  |  |><|  |  |',
  '  |  +--+  +--+  |',
  '  |              |',
  ' [________________]',
];

const ART_WIDTH = Math.max(...LOGO_ART.map((l) => l.length));

/**
 * `--help` basligi ve TTY rapor basligi icin satirlar.
 *
 * Renk, colors.js gibi TERM/CI kosullariyla kapanir; kapaliyken duz metin.
 *
 * @param {string} version
 * @returns {string[]}
 */
export function bannerLines(version = '') {
  const art = LOGO_ART.map((l) => l.padEnd(ART_WIDTH));
  const texts = [
    `${bold('deaddeps')}${version ? ` ${dim('v' + version)}` : ''}`,
    'find dead, unmaintained and stale dependencies',
    'https://github.com/RetroNyym/deaddeps',
    dim('zero dependencies  ·  no API keys  ·  MIT'),
  ];
  const out = [];
  for (let i = 0; i < Math.max(art.length, texts.length); i++) {
    const left = `  ${art[i] ?? ' '.repeat(ART_WIDTH)}`;
    const right = texts[i] ?? '';
    out.push(right ? `${left}  ${right}` : left);
  }
  return out;
}
