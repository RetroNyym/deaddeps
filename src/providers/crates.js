/**
 * crates.io saglayicisi.
 *
 * Tek istek: `https://crates.io/api/v1/crates/<ad>`
 *  - `versions[0]`      -> en yeni surum (crates.io'da en bastadir)
 *  - `versions[0].yanked` -> npm deprecated karsiligi
 *  - `crate.recent_downloads` -> son 90 gun (ayliga bolunur)
 *
 * crates.io `User-Agent` basligini zorunlu tutar — isteklerde gonderilir.
 */

import { USER_AGENT } from '../http.js';

const BASE = 'https://crates.io/api/v1/crates';

export const registryUrl = (name) => `https://crates.io/crates/${name}`;

/** crates.io anonim isteklerde User-Agent ister. */
export const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json',
};

export async function lookupCrates(name, { cache, getJson }, opts = {}) {
  const data = await getJson(`${BASE}/${encodeURIComponent(name)}`, { cache, headers: HEADERS });
  if (!data || typeof data !== 'object' || !data.crate) {
    return { name, found: false, exists: false, source: 'none' };
  }

  const crate = data.crate;
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const pinned = typeof opts.version === 'string' && opts.version ? opts.version : null;

  // Durum: en yeni surumun yayim tarihi (npm/PyPI ile ayni kural).
  const latestVersion = crate.max_version ?? null;
  const latestTarget =
    (latestVersion ? versions.find((v) => v && v.num === latestVersion) : null) ??
    versions[0] ??
    null;
  // Ekranda goruntulenen: Cargo.lock'taki kurulu surum.
  const installedTarget = pinned ? versions.find((v) => v && v.num === pinned) ?? null : null;

  const createdAt = latestTarget?.created_at ?? crate.updated_at ?? null;
  // `yanked` surum bazlidir: kurulu surum yanked ise bu kurulum icin
  // gecerli bir "kullanma" isaretidir.
  const yankedInstalled = Boolean(installedTarget?.yanked);
  const yankedLatest = Boolean(latestTarget?.yanked);
  const yanked = yankedInstalled || yankedLatest;

  const recent = Number(crate.recent_downloads);

  const repository = crate.repository ?? crate.homepage ?? null;

  return {
    name,
    found: true,
    exists: true,
    lastPublish: createdAt,
    version: installedTarget?.num ?? latestVersion ?? null,
    // crates.io tek istekte bakimci listesi vermiyor; bilinmedigi icin null
    // birakilir ve skor yalnizca tarih uzerinden hesaplanir.
    maintainers: null,
    deprecated: yanked,
    deprecationReason: yanked
      ? yankedInstalled
        ? 'installed version yanked (withdrawn)'
        : 'latest version yanked (withdrawn)'
      : null,
    repository,
    hasRepository: Boolean(repository),
    registry: registryUrl(name),
    downloadsMonthly: null,
    recentDownloads: Number.isFinite(Number(crate.recent_downloads)) ? Number(crate.recent_downloads) : null,
    dependents: null,
    stars: null,
    source: 'crates-api',
    // aylik indirme yerine 90 gunluk degeri sakliyoruz; skorlamada
    // `downloadsMonthly` yerine asagida duzeltilir.
    downloadsMonthlyRaw90d: Number.isFinite(recent) ? recent : null,
  };
}
