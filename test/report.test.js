import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderText, renderJson, renderCompact } from '../src/report.js';
import { analyze } from '../src/score.js';

const BIN = fileURLToPath(new URL('../bin/deaddeps.js', import.meta.url));

const NOW = Date.parse('2026-09-27T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

function row(name, status, downloadsMonthly = 1000) {
  const days = { dead: 2000, unmaintained: 800, stale: 400, healthy: 10, unknown: null }[status];
  const r = analyze({
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
  return r;
}

const meta = { directCount: 3, transitiveCount: 4, durationMs: 1234, cacheHits: 10 };

test('renderText: baslik, ozet sayaclari ve durum basliklari', () => {
  const rows = [row('dep-a', 'dead'), row('old', 'unmaintained'), row('tired', 'stale'), row('fresh', 'healthy')];
  const out = renderText({ rows, meta, width: 100 });
  assert.match(out, /deaddeps/);
  assert.match(out, /1 DEAD/);
  assert.match(out, /1 UNMAINTAINED/);
  assert.match(out, /1 STALE/);
  assert.match(out, /1 HEALTHY/);
  assert.match(out, /DEAD \(1\)/);
});

test('renderText: uzun listeler ust sinirda kesilir ve "+N daha" gosterir', () => {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row(`dead-pkg-${i}`, 'dead'));
  const out = renderText({ rows, meta, width: 100 });
  assert.match(out, /DEAD \(40\)/);
  assert.match(out, /\+25 more/, '40 dead, limit 15 -> +25');
  const listed = out.split('\n').filter((l) => /^ {2}dead-pkg-\d+/.test(l));
  assert.equal(listed.length, 15);
});

test('renderText: URL kiriligi yok (registry satiri baslatinca)', () => {
  const rows = [row('dep-a', 'dead')];
  const out = renderText({ rows, meta, width: 100 });
  assert.ok(!out.includes('https://www.npmjs.com/package/'), 'varsayilan ciktilda URL olmamali');
});

test('renderText: saglikli paketler yalnizca --show-healthy ile', () => {
  const rows = [row('fresh', 'healthy')];
  const hidden = renderText({ rows, meta, width: 100 });
  assert.ok(!hidden.includes('HEALTHY ('));
  const shown = renderText({ rows, meta, showHealthy: true, width: 100 });
  assert.match(shown, /HEALTHY \(1\)/);
});

test('renderText: sifir sorunda temiz mesaji', () => {
  const rows = [row('fresh', 'healthy'), row('fresh2', 'healthy')];
  const out = renderText({ rows, meta, width: 100 });
  assert.match(out, /All good/);
});

test('renderText: deprecated paketin npm mesaji gosterilir', () => {
  const r = row('dep-a', 'dead');
  r.deprecationReason = 'request has been deprecated, see https://example.com/x';
  const out = renderText({ rows: [r], meta, width: 100 });
  assert.match(out, /npm: request has been deprecated/);
  assert.ok(!out.includes('https://example.com/x') || out.includes('npm:'), 'mesaj tek satirda');
});

test('renderCompact: tek satir ve sayimlar dogru', () => {
  const rows = [row('dep-a', 'dead'), row('fresh', 'healthy'), row('tired', 'stale')];
  const out = renderCompact(rows);
  assert.equal(out.split('\n').length, 1);
  assert.match(out, /3 packages/);
  assert.match(out, /💀 1/);
  assert.match(out, /✅ 1/);
});

test('renderJson: makine okunur ve tum alanlar mevcut', () => {
  const rows = [row('dep-a', 'dead'), row('fresh', 'healthy')];
  const parsed = JSON.parse(renderJson(rows, { version: '1.0.0' }));
  assert.equal(parsed.tool, 'deaddeps');
  assert.equal(parsed.version, '1.0.0');
  assert.equal(parsed.summary.total, 2);
  assert.equal(parsed.packages.length, 2);
  assert.equal(parsed.packages[0].name, 'dep-a', 'en kotu paket once gelir');
  for (const key of ['status', 'score', 'lastPublish', 'downloadsMonthly', 'reasons', 'registry']) {
    assert.ok(key in parsed.packages[0], `alan eksik: ${key}`);
  }
});

// ---------------------------------------------------------------------------
// CLI: cikis kodlari
// ---------------------------------------------------------------------------

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

test('cli: --help 0 doner ve kullanimi gosterir', async () => {
  const { code, stdout } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /USAGE/);
  assert.match(stdout, /--fail-on/);
  assert.match(stdout, /STATUSES/);
});

test('cli: --version 0 doner', async () => {
  const { code, stdout } = await run(['--version']);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('cli: gecersiz --fail-on 2 doner', async () => {
  const { code, stderr } = await run(['--fail-on', 'yok-boyle-bir-sey']);
  assert.equal(code, 2);
  assert.match(stderr, /invalid --fail-on/);
});

test('cli: gecersiz --min-score 2 doner', async () => {
  const { code, stderr } = await run(['--min-score', '150']);
  assert.equal(code, 2);
  assert.match(stderr, /between 0 and 100/);
});

test('cli: var olmayan dizin 2 doner', async () => {
  const { code, stderr } = await run(['C:\\__deaddeps_yok_boyle_dir__']);
  assert.equal(code, 2);
  assert.match(stderr, /not found/);
});
