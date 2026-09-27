import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bannerLines, logoSvg, LOGO_ART, LOGO_STONE_PATH, LOGO_MARKUP } from '../src/logo.js';
import { stripAnsi } from '../src/colors.js';

const LOGO_FILE = fileURLToPath(new URL('../docs/logo.svg', import.meta.url));

test('banner: sanat kolonu hizali, metin kolonu tek yerde baslar', () => {
  const lines = bannerLines('1.2.3').map(stripAnsi);
  const artWidth = Math.max(...LOGO_ART.map((l) => l.length));
  const textCol = 2 + artWidth + 2;
  assert.equal(lines.length, LOGO_ART.length);
  LOGO_ART.forEach((art, i) => {
    assert.ok(lines[i].startsWith(`  ${art}`), `satir ${i} sanatiyla hizali degil: "${lines[i]}"`);
  });
  const withText = lines.filter((l) => l.length > textCol);
  assert.equal(withText.length, 4, 'dort metin satiri');
  for (const l of withText) {
    assert.equal(l.slice(2 + artWidth, textCol), '  ', `metin kolonu kaymis: "${l}"`);
  }
  assert.ok(lines[0].slice(textCol).startsWith('deaddeps'));
});

test('banner: ad, surum, url ve slogan var', () => {
  const text = stripAnsi(bannerLines('1.2.3').join('\n'));
  assert.match(text, /deaddeps/);
  assert.match(text, /v1\.2\.3/);
  assert.match(text, /https:\/\/github\.com\/RetroNyym\/deaddeps/);
  assert.match(text, /find dead, unmaintained and stale dependencies/);
});

test('banner: ASCII armasi mezar tasi + kirik baglanti ciziyor', () => {
  const art = LOGO_ART.join('\n');
  assert.match(art, /\+--\+/, 'iki kutu');
  assert.ok(art.includes('><'), 'kopuk baglanti isareti');
  assert.match(art, /_+/, 'kubbe ve zemin');
  assert.ok(LOGO_ART.length >= 8, 'tas sekli yeterince yuksek');
  // zemin en genis satir olmali (tas tabanindan bir karakter disarida)
  const widest = Math.max(...LOGO_ART.map((l) => l.length));
  assert.equal(LOGO_ART[LOGO_ART.length - 1].length, widest);
});

test('logoSvg: tek etiket, harici font/script yok', () => {
  const svg = logoSvg({ width: 96 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes('aria-label="deaddeps"'));
  assert.ok(!/<script/i.test(svg));
  assert.ok(!/font-family/i.test(svg));
  assert.equal((svg.match(/</g) || []).length, (svg.match(/>/g) || []).length);
});

test('docs/logo.svg ile src/logo.js ayni tasi ciziyor', () => {
  const file = fs.readFileSync(LOGO_FILE, 'utf8');
  assert.ok(file.includes(LOGO_STONE_PATH), 'tas yolu iki yerde ayni olmali');
  assert.ok(file.includes('<rect width="128" height="128" rx="28"'), 'karo');
  for (const fragment of ['M56 68h4', 'M72 68h-4', 'x="40" y="61"']) {
    assert.ok(LOGO_MARKUP.includes(fragment), `markup eksik: ${fragment}`);
    assert.ok(file.includes(fragment), `docs/logo.svg eksik: ${fragment}`);
  }
});
