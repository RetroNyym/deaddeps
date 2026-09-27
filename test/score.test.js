import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysSince,
  humanAge,
  humanCount,
  classify,
  score,
  analyze,
  summarize,
  blastRadius,
  bySeverity,
  AGE_THRESHOLDS,
} from '../src/score.js';

const NOW = Date.parse('2026-09-27T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

test('daysSince: gecerli tarih gun olarak doner', () => {
  assert.equal(daysSince(iso(10), NOW), 10);
  assert.equal(daysSince(iso(0), NOW), 0);
});

test('daysSince: gecersiz girdi null doner', () => {
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince(undefined, NOW), null);
  assert.equal(daysSince('tarihinin-adi', NOW), null);
  assert.equal(daysSince('', NOW), null);
});

test('humanAge: sinir degerleri', () => {
  assert.equal(humanAge(0), 'today');
  assert.equal(humanAge(29), '29d');
  assert.equal(humanAge(30), '1mo');
  assert.equal(humanAge(400), '13mo');
  assert.equal(humanAge(800), '2.2y');
  assert.equal(humanAge(1000), '2.7y');
  assert.equal(humanAge(null), 'unknown');
  assert.equal(humanAge(undefined), 'unknown');
});

test('humanCount: kisa bicimler', () => {
  assert.equal(humanCount(999), '999');
  assert.equal(humanCount(1000), '1K');
  assert.equal(humanCount(1500), '1.5K');
  assert.equal(humanCount(1e6), '1M');
  assert.equal(humanCount(2.5e6), '2.5M');
  assert.equal(humanCount(1e9), '1B');
  assert.equal(humanCount(null), null);
  assert.equal(humanCount('abc'), null);
});

test('classify: esikler asagi agidir', () => {
  // deprecated her seyi ezer
  assert.equal(classify({ lastPublishDays: 0, deprecated: true }), 'dead');
  assert.equal(classify({ lastPublishDays: 1, deprecated: false }), 'healthy');
  assert.equal(classify({ lastPublishDays: AGE_THRESHOLDS.stale + 1, deprecated: false }), 'stale');
  assert.equal(classify({ lastPublishDays: AGE_THRESHOLDS.unmaintained + 1, deprecated: false }), 'unmaintained');
  assert.equal(classify({ lastPublishDays: AGE_THRESHOLDS.dead + 1, deprecated: false }), 'dead');
  // tam sinir gunu hala asagidaki durumda kalir (>)
  assert.equal(classify({ lastPublishDays: AGE_THRESHOLDS.dead, deprecated: false }), 'unmaintained');
  assert.equal(classify({ lastPublishDays: AGE_THRESHOLDS.unmaintained, deprecated: false }), 'stale');
  assert.equal(classify({ lastPublishDays: AGE_THRESHOLDS.stale, deprecated: false }), 'healthy');
});

test('classify: tarih bilinmiyorsa unknown', () => {
  assert.equal(classify({ lastPublishDays: null, deprecated: false }), 'unknown');
  assert.equal(classify({ lastPublishDays: undefined, deprecated: false }), 'unknown');
});

test('score: deprecated sifir verir', () => {
  assert.equal(score({ deprecated: true, lastPublishDays: 0 }), 0);
  assert.equal(score({ deprecated: true }), 0);
});

test('score: taze paket tam puan', () => {
  assert.equal(score({ lastPublishDays: 10 }), 100);
});

test('score: yas cezalari README tablosuyla ayni', () => {
  const cases = [
    [200, -5], // 0.5-1 yil
    [400, -15], // 1-2 yil
    [800, -30], // 2-3 yil
    [1300, -45], // 3-5 yil
    [2000, -60], // >5 yil
  ];
  for (const [days, delta] of cases) {
    assert.equal(score({ lastPublishDays: days }), 100 + delta, `${days} gun -> ${delta}`);
  }
});

test('score: tarih bilinmiyorsa 20 puan iner', () => {
  assert.equal(score({ lastPublishDays: null }), 80);
  assert.equal(score({}), 80);
});

test('score: bus factor cezalari', () => {
  assert.equal(score({ lastPublishDays: 10, maintainers: 0 }), 70);
  assert.equal(score({ lastPublishDays: 10, maintainers: 1 }), 90);
  assert.equal(score({ lastPublishDays: 10, maintainers: 2 }), 97);
  assert.equal(score({ lastPublishDays: 10, maintainers: 5 }), 100);
  assert.equal(score({ lastPublishDays: 10, maintainers: null }), 100);
});

test('score: kaynak baglantisi yoksa 5 puan iner', () => {
  assert.equal(score({ lastPublishDays: 10, hasRepository: false }), 95);
  assert.equal(score({ lastPublishDays: 10, hasRepository: true }), 100);
  assert.equal(score({ lastPublishDays: 10, hasRepository: null }), 100);
});

test('score: hicbir zaman 0-100 disina cikmaz', () => {
  const worst = score({ lastPublishDays: 4000, maintainers: 0, hasRepository: false });
  // 100 - 60 (yas) - 30 (bakimci yok) - 5 (repo yok) = 5
  assert.equal(worst, 5);
  const floor = score({ lastPublishDays: 4000, maintainers: 0, hasRepository: false, deprecated: true });
  assert.equal(floor, 0);
  assert.ok(worst >= 0 && worst <= 100);
});

test('analyze: tum alanlari dogru birlestirir', () => {
  const row = analyze({
    name: 'request',
    version: '2.88.2',
    ecosystem: 'npm',
    kind: 'direct',
    lastPublish: iso(2419),
    deprecated: true,
    deprecationReason: 'request has been deprecated',
    maintainers: 4,
    hasRepository: true,
    registry: 'https://www.npmjs.com/package/request',
    downloadsMonthly: 55781802,
    now: NOW,
  });
  assert.equal(row.status, 'dead');
  assert.equal(row.score, 0);
  assert.equal(row.lastPublishDays, 2419);
  assert.equal(row.deprecated, true);
  assert.equal(row.downloadsMonthly, 55781802);
  assert.ok(row.reasons.some((r) => r.includes('deprecated')));
});

test('analyze: bakimci sayisini gerekceye yazar', () => {
  const row = analyze({ name: 'a', lastPublish: iso(100), maintainers: 1, now: NOW });
  assert.ok(row.reasons.includes('single maintainer'));
  const none = analyze({ name: 'b', lastPublish: iso(100), maintainers: 0, now: NOW });
  assert.ok(none.reasons.includes('no maintainers'));
});

test('summarize: sayimlar dogru', () => {
  const rows = ['dead', 'dead', 'stale', 'healthy', 'unknown', 'unmaintained'].map((status) => ({ status }));
  const s = summarize(rows);
  assert.equal(s.dead, 2);
  assert.equal(s.unmaintained, 1);
  assert.equal(s.stale, 1);
  assert.equal(s.healthy, 1);
  assert.equal(s.unknown, 1);
  assert.equal(s.total, 6);
  assert.equal(s.flagged, 4);
});

test('blastRadius: sadece dead + unmaintained sayilir', () => {
  const rows = [
    { status: 'dead', downloadsMonthly: 100, dependents: 10 },
    { status: 'unmaintained', downloadsMonthly: 50, dependents: 5 },
    { status: 'stale', downloadsMonthly: 1000000, dependents: 999 },
    { status: 'healthy', downloadsMonthly: 1000000, dependents: 999 },
    { status: 'dead', downloadsMonthly: null, dependents: null },
  ];
  const b = blastRadius(rows);
  assert.equal(b.downloads, 150);
  assert.equal(b.dependents, 15);
  assert.equal(b.packages, 3);
});

test('bySeverity: once durum, sonra skor, sonra indirme', () => {
  const a = { status: 'dead', score: 0, downloadsMonthly: 1, name: 'a' };
  const b = { status: 'healthy', score: 100, downloadsMonthly: 9e9, name: 'b' };
  assert.ok(bySeverity(a, b) < 0);

  const worse = { status: 'dead', score: 10, downloadsMonthly: 0, name: 'w' };
  const better = { status: 'dead', score: 50, downloadsMonthly: 0, name: 'z' };
  assert.ok(bySeverity(worse, better) < 0);

  const hot = { status: 'dead', score: 10, downloadsMonthly: 5000, name: 'h' };
  const cold = { status: 'dead', score: 10, downloadsMonthly: 10, name: 'c' };
  assert.ok(bySeverity(hot, cold) < 0);
});
