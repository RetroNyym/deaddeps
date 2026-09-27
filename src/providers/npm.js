/**
 * npm saglayicisi.
 *
 * ============================================================
 *  Neden boyle? (Bu kisim degisikligi kodun omru boyunca
 *  en pahali ogrenme oldu, not dusuldu.)
 * ============================================================
 *
 *  Ilk deneme `/-/v1/search` uzerine kurulmustu: tek istekte son yayin
 *  tarihi + indirme + bakimci geliyordu. Deney sonucu: npm'in arama
 *  ucu ciddi sekilde rate-limit yiyor. Eszamanli 16 istekte %50,
 *  ardindan seri 50ms aralikla bile 9/30 basarili (429). Yani bu
 *  tasarim 150 bagimlilikli bir projede calismaz.
 *
 *  Olcum sonrasi rate-limit yemeyen uc tek existedi:
 *      registry.npmjs.org/<ad>/latest   30/30, ~2 KB
 *      api.npmjs.org/downloads/...      30/30, ~0.5 KB
 *      api.deps.dev/.../versions/<v>    30/30, ~1.1 KB
 *
 *  Son mimari — paket basina 2 istek, ~3 KB:
 *
 *   1. `/<ad>/latest`     -> surum, npm'in "kullanma" mesaji,
 *                            bakimci sayisi, kaynak baglantisi
 *   2. deps.dev tek surum -> `publishedAt` (dogru son yayin tarihi)
 *
 *  deps.dev tam paket ucu 880 KB dondugunden (typescript) tek surum
 *  ucu tercih edildi; surumu 1. adimdan zaten ogreniyoruz.
 *  Deger olcumu: 30 paket / 664ms / 37 KB / 30-30 tarih.
 *
 *  ============================================================
 *  Neden "latest" surumun tarihi, kurulu surumun tarihi degil?
 *  ============================================================
 *  Deneme 1: lockfile'daki kurulu surumun tarihine bakildi — 150
 *  paketlik ornek projede 91 DEAD cikti. cogu yanlisti: `debug@4.3.4`
 *  uc yil once yayimlanmis ama paket hala ayda bir guncelleniyor.
 *  Soru "bu pakete bakan var mi", "senin pin'in kac yasinda" degil;
 *  ikincisi `npm outdated`'un isi.
 *
 *  Kurulu surum yine de iki noktada kullanilir:
 *    - ekranda goruntulenen surum (lockfile'daki)
 *    - npm surum bazli `deprecated` bayragi: eski surum "kullanma"
 *      isaretlenmis ama latest tazeyse bu yine de sizin kurdugunuz
 *      surum icin gecerli bir "olmus" haberidir.
 *
 *  3. indirme sayilari AYRI bir geciste, tek toplu istekte sorulur.
 *     npm toplu ucunu (`/point/last-month/a,b,c`) destekliyor: 90 paket
 *     tek istekte, ~2 KB. Tek tek sormak 429 yedi (olcum: dakikada
 *     ~40 istekten sonra Cloudflare kilitlemesi) — bu yuzden toplu sorgu
 *     zorunludur, tercih degil. Scope'lu paketler (@ad) toplu ucda
 *     calismiyor ("scoped packages are not currently supported in bulk
 *     lookups") → onlar tek tek sorulur ve sayilari azdir.
 */

const REGISTRY = 'https://registry.npmjs.org';
const DEPSDEV = 'https://api.deps.dev/v3alpha/systems/npm/packages';
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-month';

/**
 * Tam packument yedegei (deps.dev ve latest ikisi de veremezse) icin bayt
 * tavan. Typescript 15 MB'lik dokuman; sinirsiz okunsaydi tek basina
 * araci yavaslatirdi. `time` alani `versions`'dan SONRA geldigi icin
 * tavan asilirsa tarih alinamaz -> paket "unknown" sayilir.
 */
const FALLBACK_MAX_BYTES = 2 * 1024 * 1024;

/**
 * npm'in `/latest` ucundeki `maintainers` dizisi her zaman guvenilir
 * degil: `ms` icin 55 kisi donuyor (npm'in paket dokumasi 6 gosteriyor).
 * 20 uzeri bir deger gercek bakimci listesi olamaz -> bilinmeyen sayilir.
 */
const MAINTAINERS_PLAUSIBLE_MAX = 20;

export const registryUrl = (name) => `https://www.npmjs.com/package/${name}`;

function sanitizeMaintainers(list) {
  if (!Array.isArray(list)) return null;
  const n = list.length;
  if (n === 0) return 0;
  if (n > MAINTAINERS_PLAUSIBLE_MAX) return null;
  return n;
}

/**
 * @param {string} name
 * @param {{cache: import('../http.js').Cache, getJson: Function}} deps
 * @param {{version?: string|null}} [opts] lockfile'daki kurulu surum
 * @returns {Promise<object>}
 */
export async function lookupNpm(name, { cache, getJson }, opts = {}) {
  const enc = encodeURIComponent(name);
  const installed = typeof opts.version === 'string' && opts.version ? opts.version : null;

  const latest = await getJson(`${REGISTRY}/${enc}/latest`, { cache });

  if (latest === undefined) {
    // /latest 2 KB; tavan asmasi beklenmez. Yine de emniyetli ol.
    return { name, found: false, exists: false, source: 'none' };
  }

  if (latest === null) {
    // 404 ya da ag hatasi. Paket yok mu, yoksa mi ulasilamadi?
    // deps.dev ile dogrula: npm'den silinmis ama hala bilinen paketler var.
    const probe = await getJson(`${DEPSDEV}/${enc}`, { cache, maxBytes: FALLBACK_MAX_BYTES });
    if (probe && Array.isArray(probe.versions) && probe.versions.length) {
      const def = probe.versions.find((v) => v && v.isDefault) ?? probe.versions[0];
      return {
        name,
        found: true,
        exists: true,
        lastPublish: def?.publishedAt ?? null,
        version: installed ?? def?.versionKey?.version ?? null,
        maintainers: null,
        deprecated: Boolean(def?.isDeprecated),
        deprecationReason: def?.deprecatedReason ?? null,
        repository: null,
        hasRepository: null,
        registry: registryUrl(name),
        downloadsMonthly: null,
        dependents: null,
        source: 'depsdev-fallback',
      };
    }
    return { name, found: false, exists: false, source: 'none' };
  }

  if (typeof latest !== 'object') {
    return { name, found: false, exists: false, source: 'none' };
  }

  // Durum: npm'in EN YENI surumunun yayin tarihi (paket bakan var mi?).
  // Ekrandaki surum ise lockfile'daki kurulu surumdur.
  const latestVersion = latest.version ?? null;
  const version = installed ?? latestVersion;
  const npmLatestDeprecated = latest.deprecated;

  // 2. istek: deps.dev tek surum -> latest surumun yayin tarihi (~1.1 KB)
  let publishedAt = null;
  if (latestVersion) {
    const devVersion = await getJson(`${DEPSDEV}/${enc}/versions/${encodeURIComponent(latestVersion)}`, {
      cache,
    });
    if (devVersion && typeof devVersion === 'object') {
      publishedAt = devVersion.publishedAt ?? null;
    }
  }

  // Surum bazli `deprecated`: npm bir surumu "kullanma" diye isaretleyip
  // diger surumleri ayni birakabilir. Kurulu surum baska ise onun bayragi
  // da sorulur (yaklask ~1.1 KB) — "sizin kurdugunuz surum olmus" haberi
  // en az latest kadar onemlidir.
  let installedDeprecated = false;
  let installedReason = null;
  if (installed && installed !== latestVersion) {
    const devInstalled = await getJson(`${DEPSDEV}/${enc}/versions/${encodeURIComponent(installed)}`, {
      cache,
    });
    if (devInstalled && typeof devInstalled === 'object') {
      installedDeprecated = Boolean(devInstalled.isDeprecated);
      installedReason = devInstalled.deprecatedReason || null;
    }
  }

  const deprecated = installedDeprecated || Boolean(npmLatestDeprecated);

  // deps.dev veremediyse yedek: npm packument (bayt sinirli)
  if (!publishedAt) {
    const doc = await getJson(`${REGISTRY}/${enc}`, { cache, maxBytes: FALLBACK_MAX_BYTES });
    if (doc && typeof doc === 'object') {
      const tag = doc['dist-tags']?.latest;
      // `time.modified` yaniltir (metadata guncellemesi tarihi oynatir);
      // dogru kaynak ilgili surumun yayin tarihidir.
      publishedAt = (latestVersion && doc.time?.[latestVersion]) || (tag && doc.time?.[tag]) || null;
    } else if (doc === undefined) {
      // tavan asti -> tarih bilinmiyor, "unknown" olacak
      publishedAt = null;
    }
  }

  const deprecationReason =
    installedReason ??
    (typeof npmLatestDeprecated === 'string' && npmLatestDeprecated.trim()
      ? npmLatestDeprecated.trim()
      : null);

  return finalize(name, {
    version,
    publishedAt,
    deprecated,
    deprecationReason,
    latest,
    source: 'npm-latest',
  });
}

function finalize(name, { version, publishedAt, deprecated, deprecationReason, latest, source }) {
  const repoUrl = latest?.repository?.url ?? null;
  return {
    name,
    found: true,
    exists: true,
    lastPublish: publishedAt,
    version,
    maintainers: sanitizeMaintainers(latest?.maintainers),
    deprecated: Boolean(deprecated),
    deprecationReason: deprecationReason ?? null,
    repository: repoUrl,
    hasRepository: repoUrl ? true : Boolean(latest?.repository) ? false : null,
    registry: registryUrl(name),
    downloadsMonthly: null,
    dependents: null,
    source,
  };
}

/**
 * Aylik indirme sayisi — bolumun kapanisindaki asil sansurun kaynagi:
 * "olu" paketlerin hala milyonlarca kez indirilmesi.
 *
 * Toplu sorgu siniri: npm en fazla 128 paket kabul ediyor (dokumanda
 * yaziyor), URL uzunlugu icin 90 ile sinirliyoruz.
 */
const BULK_CHUNK = 90;

function addEntries(map, data) {
  if (!data || typeof data !== 'object') return;
  for (const [name, entry] of Object.entries(data)) {
    const n = Number(entry?.downloads);
    if (Number.isFinite(n)) map.set(name, n);
  }
}

/**
 * Bir dizi paket icin aylik indirme sayilarini tek (veya az sayida)
 * istekte alir.
 *
 * @param {string[]} names
 * @param {{cache: import('../http.js').Cache, getJson: Function}} deps
 * @returns {Promise<Map<string, number>>} ad -> aylik indirme
 */
export async function npmDownloadsBulk(names, deps) {
  const out = new Map();
  const list = [...new Set(names)].filter(Boolean);
  if (!list.length) return out;

  const unscoped = list.filter((n) => !n.startsWith('@'));
  const scoped = list.filter((n) => n.startsWith('@'));

  for (let i = 0; i < unscoped.length; i += BULK_CHUNK) {
    const chunk = unscoped.slice(i, i + BULK_CHUNK);
    const url = `${DOWNLOADS}/${chunk.map(encodeURIComponent).join(',')}`;
    const data = await deps.getJson(url, { cache: deps.cache, maxBytes: 1024 * 1024 });
    addEntries(out, data);
  }

  // scope'lu paketler toplu ucda desteklenmiyor; sayilari genelde az
  // oldugundan sirayla sorulur.
  for (const name of scoped) {
    const dl = await npmDownloads(name, deps);
    if (dl !== null) out.set(name, dl);
  }
  return out;
}

export async function npmDownloads(name, { cache, getJson }) {
  const data = await getJson(`${DOWNLOADS}/${encodeURIComponent(name)}`, { cache });
  if (data && Number.isFinite(Number(data.downloads))) return Number(data.downloads);
  return null;
}
