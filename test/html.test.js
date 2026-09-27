import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../src/html.js';
import { analyze } from '../src/score.js';

const BIN = fileURLToPath(new URL('../bin/deaddeps.js', import.meta.url));

const NOW = Date.parse('2026-09-27T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

function row(name, status, downloadsMonthly = 1000) {
  const days = { dead: 2000, unmaintained: 800, stale: 400, healthy: 10, unknown: null }[status];
  return analyze({
    name,
    version: '1.0.0',
    ecosystem: 'npm',
    kind: 'direct',
    lastPublish: status === 'unknown' ? null : iso(days),
    deprecated: status === 'dead' && name.startsWith('dep-'),
    maintainers: 1,
    hasRepository: true,
    downloadsMonthly,
    now: NOW,
  });
}

const meta = { root: '/tmp/demo', directCount: 3, transitiveCount: 4, durationMs: 1234 };

test('html: doctype, logo ve baslik var', () => {
  const html = renderHtml({ rows: [row('dep-a', 'dead')], meta, version: '1.0.0' });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<title>deaddeps report/);
  assert.match(html, /<svg[^>]+aria-label="deaddeps"/, 'logo satir icinde gömülü');
  assert.match(html, /deaddeps v1\.0\.0/);
  assert.match(html, /Find dead, unmaintained and stale dependencies/);
});

test('html: ozet sayaclari, paketler ve durum etiketleri yer alir', () => {
  const rows = [row('dep-a', 'dead'), row('old', 'unmaintained'), row('tired', 'stale'), row('fresh', 'healthy')];
  const html = renderHtml({ rows, meta, version: '1.0.0' });
  for (const [cls, label] of [
    ['card dead', 'DEAD'],
    ['card unmaintained', 'UNMAINTAINED'],
    ['card stale', 'STALE'],
    ['card healthy', 'HEALTHY'],
  ]) {
    assert.ok(html.includes(cls), `${cls} karti yok`);
    assert.ok(html.includes(label), `${label} etiketi yok`);
  }
  for (const name of ['dep-a', 'old', 'tired', 'fresh']) {
    assert.ok(html.includes(`data-name="${name}"`), `${name} listede yok`);
  }
  // siralama: en kotu durum once
  assert.ok(html.indexOf('data-name="dep-a"') < html.indexOf('data-name="fresh"'));
});

test('html: XSS kiriligi — ad ve mesaj kacirilir', () => {
  const r = row('safe', 'dead');
  r.name = '<img src=x onerror=alert(1)>';
  r.deprecationReason = '</script><script>alert(2)</script>';
  r.deprecated = true;
  r.reasons = ['npm: "<b>bold</b>"'];
  const html = renderHtml({ rows: [r], meta });
  assert.ok(!/<img src=x onerror/.test(html), 'kirli ad oldugu gibi basilmis');
  assert.ok(!/<script>alert\(2\)<\/script>/.test(html), 'kirli mesaj oldugu gibi basilmis');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;'));
});

test('html: harici kaynak yok — dosya kendine yetiyor', () => {
  const html = renderHtml({ rows: [row('dep-a', 'dead'), row('fresh', 'healthy')], meta });
  assert.ok(!/<script[^>]+src=/i.test(html), 'dis script');
  assert.ok(!/<link[^>]+href="https?:/i.test(html), 'dis stylesheet');
  assert.ok(!/<img[^>]+src="https?:/i.test(html), 'dis gorsel');
  assert.ok(!/@import/i.test(html), '@import');
  assert.ok(!/url\(\s*["']?https?:/i.test(html), 'css uzerinden istek');
  // xmlns bir ad alani tanimidir, istek degildir.
  assert.ok(html.includes('xmlns="http://www.w3.org/2000/svg"'));
});

test('html: filtreler data-status ile eslesir, JS ozellikleri ekler', () => {
  const rows = [row('dep-a', 'dead'), row('fresh', 'healthy')];
  const html = renderHtml({ rows, meta });
  assert.match(html, /<input id="q" type="search"/);
  assert.match(html, /class="f on" data-f="all"/);
  assert.match(html, /data-f="dead"/);
  assert.ok(html.includes('el.getAttribute("data-status")') || html.includes("el.getAttribute('data-status')") || html.includes("getAttribute('data-status')"));
});

test('html: sifir soruda temiz mesaji', () => {
  const html = renderHtml({ rows: [row('fresh', 'healthy')], meta });
  assert.match(html, /No dependencies found|All good/);
});

test('html: patlama yarisi uyarisi', () => {
  const rows = [row('dep-a', 'dead', 5000000)];
  const html = renderHtml({ rows, meta });
  assert.match(html, /5M downloads\/mo/);
  assert.match(html, /dead\/unmaintained package/);
});

test('cli: --html dosya yazar ve 0 doner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deaddeps-html-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'probe', version: '1.0.0', dependencies: {} })
    );
    const out = path.join(dir, 'out', 'report.html');
    const code = await new Promise((resolve) => {
      execFile(process.execPath, [BIN, '--html', out, dir], { timeout: 60000 }, (err) => {
        resolve(err ? (err.code ?? 1) : 0);
      });
    });
    assert.equal(code, 0);
    const written = fs.readFileSync(out, 'utf8');
    assert.match(written, /^<!doctype html>/i);
    assert.match(written, /probe|No dependencies/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
