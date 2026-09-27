/**
 * Skorlama motoru — saf fonksiyonlar, ag yok, yan etki yok.
 *
 * ============================================================
 *  Neden boyle puanliyoruz?
 * ============================================================
 *  Aractan beklenen sey "hangi paket guvenlik acigi tasiyor" degil
 *  (bunu `npm audit` / Snyk zaten yapiyor) — "hangi paket kimse
 *  tarafindan artik bakim gorulmuyor".
 *
 *  Tum kararlar kasitli olarak acik ve tek satirda aciklanabilir:
 *  HN/Reddit'te "skor nereden geliyor?" sorusu gelmeden cevapli olmali.
 *
 *  Durum (status) asagi agidir; skor yalnizca siralama ve
 *  `--min-score` eşiği icin kullanilir:
 *
 *    deprecated  ->  dead          (yayinlayici "kullanma" demis)
 *    age > 4y    ->  dead
 *    age > 2y    ->  unmaintained
 *    age > 1y    ->  stale
 *    age <= 1y   ->  healthy
 */

/** Durum onem sirasi: kucuk = daha kotu. */
export const STATUS_ORDER = ['dead', 'unmaintained', 'stale', 'unknown', 'healthy'];

export const STATUS_META = {
  dead: { emoji: '\u{1F480}', label: 'DEAD', color: 'red' },
  unmaintained: { emoji: '\u{1F7E0}', label: 'UNMAINTAINED', color: 'yellow' },
  stale: { emoji: '\u{1F7E1}', label: 'STALE', color: 'yellow' },
  unknown: { emoji: '?', label: 'UNKNOWN', color: 'gray' },
  healthy: { emoji: '\u2705', label: 'HEALTHY', color: 'green' },
};

export const DAY_MS = 24 * 3600 * 1000;
export const YEAR_DAYS = 365;

/** ISO tarihin kac gun once oldugunu dondurur. Gecersiz girdi -> null. */
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY_MS);
}

/** Insanin okuyabilecegi sure: "3 mo", "2.4 yr" — CLI dili Ingilizce. */
export function humanAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 1) return 'today';
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months}mo`;
  const years = days / YEAR_DAYS;
  if (years < 100) return `${years.toFixed(1).replace(/\.0$/, '')}y`;
  return `${Math.floor(years)}y`;
}

/** Insanin okuyabilecegi indirme sayisi: "1.2M/ay". */
export function humanCount(n) {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

/** Yas esikleri (gun). */
export const AGE_THRESHOLDS = {
  stale: 365,
  unmaintained: 730,
  dead: 1460,
};

/**
 * Durumu belirler.
 * @param {{lastPublishDays: number|null, deprecated: boolean}} s
 */
export function classify({ lastPublishDays, deprecated }) {
  if (deprecated) return 'dead';
  if (lastPublishDays === null || lastPublishDays === undefined) return 'unknown';
  if (lastPublishDays > AGE_THRESHOLDS.dead) return 'dead';
  if (lastPublishDays > AGE_THRESHOLDS.unmaintained) return 'unmaintained';
  if (lastPublishDays > AGE_THRESHOLDS.stale) return 'stale';
  return 'healthy';
}

/**
 * 0-100 skor uretir. Yuksek = saglikli.
 * Adimlar README'deki tablo ile birebir aynidir.
 *
 * @param {{lastPublishDays?: number|null, deprecated?: boolean,
 *          maintainers?: number|null, hasRepository?: boolean|null}} s
 */
export function score(s) {
  const {
    lastPublishDays = null,
    deprecated = false,
    maintainers = null,
    hasRepository = null,
  } = s;

  // Yayinlayici "kullanma" demis: skor kalmaz.
  if (deprecated) return 0;

  let v = 100;

  // Son yayindan beri gecen sure
  if (lastPublishDays !== null && lastPublishDays !== undefined) {
    const years = lastPublishDays / YEAR_DAYS;
    if (years > 5) v -= 60;
    else if (years > 3) v -= 45;
    else if (years > 2) v -= 30;
    else if (years > 1) v -= 15;
    else if (years > 0.5) v -= 5;
  } else {
    v -= 20; // tarih bilinemiyorsa temkinli indirim
  }

  // Bus factor: tek kisi ayakta tutuyorsa kirilganlik var.
  if (maintainers === 0) v -= 30;
  else if (maintainers === 1) v -= 10;
  else if (maintainers === 2) v -= 3;

  // Kaynak baglantisi olmayan paket denetlenemez.
  if (hasRepository === false) v -= 5;

  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Tek bir bagimlilik kaydi icin tum ciktilari uretir.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.version]
 * @param {string} [input.lastPublish]   ISO tarih (son yayin)
 * @param {boolean} [input.deprecated]
 * @param {string} [input.deprecationReason]
 * @param {number} [input.maintainers]
 * @param {boolean|null} [input.hasRepository]
 * @param {string} [input.repository]
 * @param {number} [input.downloadsMonthly]
 * @param {number} [input.dependents]
 * @param {string} [input.ecosystem]      npm | pypi | crates
 * @param {string} [input.registry]       paket sayfasi
 * @param {'direct'|'transitive'} [input.kind]
 * @param {Date|number} [input.now]
 */
export function analyze(input) {
  const now = input.now ?? Date.now();
  const lastPublishDays = daysSince(input.lastPublish, typeof now === 'number' ? now : now.getTime());
  const deprecated = Boolean(input.deprecated);

  const status = classify({ lastPublishDays, deprecated });
  const value = score({
    lastPublishDays,
    deprecated,
    maintainers: input.maintainers ?? null,
    hasRepository: input.hasRepository ?? null,
  });

  const reasons = [];
  if (deprecated) {
    reasons.push(input.deprecationReason ? `npm: "${input.deprecationReason}"` : 'deprecated by the publisher');
  }
  if (lastPublishDays !== null) {
    reasons.push(`last publish ${humanAge(lastPublishDays)} ago`);
  }
  if (input.maintainers === 0) reasons.push('no maintainers');
  else if (input.maintainers === 1) reasons.push('single maintainer');
  if (input.hasRepository === false) reasons.push('no repository link');

  return {
    name: input.name,
    version: input.version ?? null,
    ecosystem: input.ecosystem ?? 'npm',
    kind: input.kind ?? 'direct',
    status,
    score: value,
    lastPublish: input.lastPublish ?? null,
    lastPublishDays,
    deprecated,
    deprecationReason: input.deprecationReason ?? null,
    maintainers: input.maintainers ?? null,
    hasRepository: input.hasRepository ?? null,
    repository: input.repository ?? null,
    registry: input.registry ?? null,
    downloadsMonthly: input.downloadsMonthly ?? null,
    dependents: input.dependents ?? null,
    reasons,
  };
}

/** Siralama anahtari: once durum onem sirasi, sonra skor (artan), sonra indirme (azalan). */
export function bySeverity(a, b) {
  const sa = STATUS_ORDER.indexOf(a.status);
  const sb = STATUS_ORDER.indexOf(b.status);
  if (sa !== sb) return sa - sb;
  if (a.score !== b.score) return a.score - b.score;
  const da = a.downloadsMonthly ?? 0;
  const db = b.downloadsMonthly ?? 0;
  if (da !== db) return db - da;
  return a.name.localeCompare(b.name);
}

/** Durum ozeti sayimlari. */
export function summarize(rows) {
  const out = { dead: 0, unmaintained: 0, stale: 0, unknown: 0, healthy: 0, total: rows.length };
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  out.flagged = out.dead + out.unmaintained + out.stale;
  return out;
}

/**
 * Olumlu paketlerin toplam "patlama yarisi": hala ne kadar indiriliyorlar.
 * Bolumun kapanisinda gosterilen asil sansur budur.
 */
export function blastRadius(rows) {
  let downloads = 0;
  let dependents = 0;
  let counted = 0;
  for (const r of rows) {
    if (r.status !== 'dead' && r.status !== 'unmaintained') continue;
    if (r.downloadsMonthly) downloads += r.downloadsMonthly;
    if (r.dependents) dependents += r.dependents;
    counted++;
  }
  return { downloads, dependents, packages: counted };
}
