/**
 * PyPI saglayicisi.
 *
 * Tek istek: `https://pypi.org/pypi/<ad>/json`
 *  - `info.version`           -> en son surum
 *  - `releases[v][0].upload_*` -> o surumun yuklenme tarihi (= son yayin)
 *  - `info.maintainers`        -> bakimci sayisi
 *  - `yanked`                  -> PyPI'nin "kullanma" isareti (npm deprecated karsiligi)
 *
 * Dürüstlük notu: PyPI resmi olarak indirme sayisi sunmaz; bunun yerine
 * bagimsiz ve anahtarsiz bir servis olan pypistats.org kullanilir.
 * Sayilar yalnizca "saglik sorunu gozuken" paketler icin sorulur:
 * arkadaki kucuk servise yuzlerce istek atmak kaba olurdu.
 */

const BASE = 'https://pypi.org/pypi';
const STATS = 'https://pypistats.org/api/packages';

export const registryUrl = (name) => `https://pypi.org/project/${name}/`;

function repoFromInfo(info) {
  const urls = info?.project_urls;
  if (urls && typeof urls === 'object') {
    for (const [key, value] of Object.entries(urls)) {
      if (typeof value !== 'string') continue;
      if (/github\.com|gitlab\.com|bitbucket\.org|codeberg\.org/i.test(value)) return value;
      if (/source|repo|code|repository|scm/i.test(key) && value.startsWith('http')) return value;
    }
    const first = Object.values(urls).find((v) => typeof v === 'string' && v.startsWith('http'));
    if (first) return first;
  }
  if (typeof info?.home_page === 'string' && info.home_page.startsWith('http')) return info.home_page;
  if (typeof info?.project_url === 'string' && info.project_url.startsWith('http')) return info.project_url;
  return null;
}

/** Bir surumun tum dosyalari yanked ise paket "iptal edilmis" sayilir. */
function latestYanked(releases, version) {
  const files = releases?.[version];
  if (!Array.isArray(files) || files.length === 0) return false;
  return files.every((f) => f && f.yanked === true);
}

/**
 * @param {string} name
 * @param {{cache: import('../http.js').Cache, getJson: Function}} deps
 * @param {{version?: string|null}} [opts] manifest'deki tam pin (`pkg==1.2.3`)
 */
export async function lookupPyPI(name, { cache, getJson }, opts = {}) {
  const data = await getJson(`${BASE}/${encodeURIComponent(name)}/json`, { cache });
  if (!data || typeof data !== 'object' || !data.info) {
    return { name, found: false, exists: false, source: 'none' };
  }

  const info = data.info;
  // Tam pin varsa ekranda ON gosterilir, ama durum en yeni surumun
  // yayim tarihine bakilir (npm ile ayni kural): "pakete bakan var mi?"
  const pinned = typeof opts.version === 'string' && opts.version ? opts.version : null;
  const latestVersion = info.version ?? null;
  const version = pinned ?? latestVersion;
  const latestFiles = latestVersion ? data.releases?.[latestVersion] : null;

  let lastPublish = null;
  if (Array.isArray(latestFiles) && latestFiles.length) {
    const times = latestFiles
      .map((f) => f?.upload_time_iso_8601 || f?.upload_time)
      .filter(Boolean)
      .map((t) => Date.parse(t))
      .filter((t) => !Number.isNaN(t));
    if (times.length) lastPublish = new Date(Math.max(...times)).toISOString();
  }
  // En yeni surumun dosya kaydi yoksa (nadir) tum surumlerden en guncel
  // tarihe bakilir.
  if (!lastPublish && data.releases) {
    const times = [];
    for (const filesOfVersion of Object.values(data.releases)) {
      if (!Array.isArray(filesOfVersion)) continue;
      for (const f of filesOfVersion) {
        const t = Date.parse(f?.upload_time_iso_8601 || f?.upload_time || '');
        if (!Number.isNaN(t)) times.push(t);
      }
    }
    if (times.length) lastPublish = new Date(Math.max(...times)).toISOString();
  }

  const repository = repoFromInfo(info);
  // `yanked` surum bazlidir: sizin pinlediginiz surum yanked ise bu sizin
  // kurulumunuz icin gecerli bir "kullanma" isaretidir.
  const yankedPinned = pinned ? latestYanked(data.releases, pinned) : false;
  const yankedLatest = latestVersion ? latestYanked(data.releases, latestVersion) : false;
  const yanked = yankedPinned || yankedLatest;

  return {
    name,
    found: true,
    exists: true,
    lastPublish,
    version,
    maintainers: Array.isArray(info.maintainers) ? info.maintainers.length : null,
    deprecated: yanked,
    deprecationReason: yanked
      ? `yanked: ${info.summary ? String(info.summary).slice(0, 140) : yankedPinned ? 'the version you have pinned was withdrawn on PyPI' : 'the latest release was withdrawn on PyPI'}`
      : null,
    repository,
    hasRepository: Boolean(repository),
    registry: registryUrl(name),
    downloadsMonthly: null,
    dependents: null,
    license: info.license ?? info.license_expression ?? null,
    source: 'pypi-json',
  };
}

/**
 * Aylik indirme — pypistats.org (npm'in toplu ucunun PyPI karsiligi yok,
 * tek paket basina istek). `recent` ucu son 30 gunu verir.
 *
 * @param {string} name
 * @param {{cache: import('../http.js').Cache, getJson: Function}} deps
 * @returns {Promise<number|null>}
 */
export async function pypiDownloads(name, { cache, getJson }) {
  const data = await getJson(`${STATS}/${encodeURIComponent(name)}/recent`, { cache });
  const v = Number(data?.data?.last_month);
  return Number.isFinite(v) ? v : null;
}
