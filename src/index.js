/**
 * Kutuphane giris noktasi — `deaddeps` icin tekrar kullanilabilir API.
 *
 *   import { scan } from 'deaddeps';
 *   const { rows, meta } = await scan({ root: process.cwd() });
 *
 * Yan etki: ag + disk onbellegi. Geri kalan her sey saf.
 */

import { detect } from './detect.js';
import { Cache, getJson, mapPool, defaultCacheDir } from './http.js';
import { analyze } from './score.js';
import {
  parsePackageJson,
  parsePackageLock,
  parseYarnLock,
  parsePnpmLock,
} from './parse/npm.js';
import { parseRequirements, parsePyproject } from './parse/pypi.js';
import { parseCargoToml, parseCargoLock } from './parse/cargo.js';
import { lookupNpm, npmDownloadsBulk } from './providers/npm.js';
import { lookupPyPI, pypiDownloads } from './providers/pypi.js';
import { lookupCrates } from './providers/crates.js';
import { readIfExists } from './detect.js';

const PROVIDERS = { npm: lookupNpm, pypi: lookupPyPI, cargo: lookupCrates };

/** @type {Record<string, {manifestDeps: (text: string) => any[], lockDeps?: (text: string, ext: string) => any[]}>} */
const PARSERS = {
  npm: {
    manifestDeps: parsePackageJson,
    lockDeps: (text, file) => {
      const base = file.replace(/^.*[\\/]/, '');
      if (base === 'yarn.lock') return parseYarnLock(text);
      if (base === 'pnpm-lock.yaml') return parsePnpmLock(text);
      return parsePackageLock(text);
    },
  },
  pypi: {
    manifestDeps: (text, file) =>
      /pyproject\.toml$/i.test(file) ? parsePyproject(text) : parseRequirements(text),
  },
  cargo: {
    manifestDeps: parseCargoToml,
    lockDeps: (text) => parseCargoLock(text),
  },
};

/**
 * Bir projedeki (manifest + lock) bagimliliklari toplar.
 * @returns {{direct: Set<string>, all: Set<string>, versions: Map<string,string>}}
 */
function collectProject(project) {
  const parser = PARSERS[project.ecosystem];
  const direct = new Set();
  const all = new Set();
  const versions = new Map();

  for (const file of project.manifests) {
    const text = readIfExists(file);
    if (text === null) continue;
    for (const dep of parser.manifestDeps(text, file)) {
      if (!dep?.name) continue;
      direct.add(dep.name);
      all.add(dep.name);
      // requirements.txt'teki `pkg==1.2.3` gibi tam pinler de kurulu
      // surumdur; lock dosyasi olmayan projelerde bunlari kacirmamak gerek.
      if (dep.version && !versions.has(dep.name)) versions.set(dep.name, dep.version);
    }
  }

  for (const file of project.lockfiles) {
    const text = readIfExists(file);
    if (text === null) continue;
    const deps = parser.lockDeps(text, file);
    for (const dep of deps) {
      if (!dep?.name) continue;
      all.add(dep.name);
      if (dep.version && !versions.has(dep.name)) versions.set(dep.name, dep.version);
    }
  }

  // lock yoksa dogrudan bagimliliklar "hepsi" sayilir
  if (!project.lockfiles.length) {
    for (const name of direct) all.add(name);
  }

  return { direct, all, versions };
}

/**
 * Taramayi calistirir.
 *
 * @param {{
 *   root?: string,
 *   directOnly?: boolean,
 *   concurrency?: number,
 *   cache?: boolean,
 *   cacheTtlMs?: number,
 *   now?: number,
 *   onProgress?: (done: number, total: number, current?: string) => void,
 * }} [options]
 * @returns {Promise<{rows: object[], meta: object}>}
 */
export async function scan(options = {}) {
  const {
    root = process.cwd(),
    directOnly = false,
    concurrency = Math.min(16, (globalThis.navigator?.hardwareConcurrency ?? 8)),
    cache: useCache = true,
    cacheTtlMs = 7 * 24 * 3600 * 1000,
    now = Date.now(),
    onProgress,
  } = options;

  const started = Date.now();
  const cache = new Cache({ dir: defaultCacheDir(), ttlMs: cacheTtlMs, enabled: useCache });

  const projects = detect(root);
  if (!projects.length) {
    return {
      rows: [],
      meta: {
        root,
        projects: 0,
        durationMs: Date.now() - started,
        directCount: 0,
        transitiveCount: 0,
        total: 0,
        message: 'No manifest found (package.json / requirements.txt / pyproject.toml / Cargo.toml)',
      },
    };
  }

  /** @type {Map<string, {name: string, ecosystem: string, direct: boolean, versions: Map<string,string>}>} */
  const unique = new Map();

  for (const project of projects) {
    const { direct, all, versions } = collectProject(project);
    for (const name of all) {
      const key = `${project.ecosystem}:${name}`;
      const existing = unique.get(key);
      if (existing) {
        if (direct.has(name)) existing.direct = true;
        for (const [v, ver] of versions) {
          if (v === name && !existing.versions.has(name)) existing.versions.set(name, ver);
        }
      } else {
        unique.set(key, {
          name,
          ecosystem: project.ecosystem,
          direct: direct.has(name),
          versions,
        });
      }
    }
  }

  let targets = [...unique.values()];
  if (directOnly) targets = targets.filter((t) => t.direct);

  const deps = { cache, getJson };

  let done = 0;
  const total = targets.length;

  const infos = await mapPool(
    targets,
    concurrency,
    async (target) => {
      const provider = PROVIDERS[target.ecosystem];
      if (!provider) return null;
      // Lockfile/manifest'daki kurulu surum saglayiciya verilir: durum
      // "kurdugunuz surum" icin gecerli olmali, registry'nin en yenisi icin degil.
      return provider(target.name, deps, { version: target.versions.get(target.name) ?? null });
    },
    (d, totalN) => {
      done = d;
      if (onProgress) onProgress(d, totalN, null);
    }
  );

  const rows = [];
  let directCount = 0;
  let transitiveCount = 0;
  let notFound = 0;

  targets.forEach((target, i) => {
    const info = infos[i];
    // Duzeltme notu: `info` saglayici sonucudur, `direct` bilgisi
    // `target` uzerindedir. Onceden `info.direct` okundugu icin sayac
    // hep sifir kaliyordu.
    if (target.direct) directCount++;
    else transitiveCount++;

    if (!info || !info.exists) {
      notFound++;
      rows.push({
        name: target.name,
        version: null,
        ecosystem: target.ecosystem,
        kind: target.direct ? 'direct' : 'transitive',
        status: 'unknown',
        score: null,
        lastPublish: null,
        lastPublishDays: null,
        deprecated: false,
        deprecationReason: null,
        maintainers: null,
        hasRepository: null,
        repository: null,
        registry: null,
        downloadsMonthly: null,
        dependents: null,
        reasons: [
          info?.exists === false
            ? `not found in the ${target.ecosystem} registry (private package or typo?)`
            : 'lookup failed',
        ],
      });
      return;
    }

    // crates.io 90 gunluk indirmeyi verir; ayliga cevrilir
    let downloadsMonthly = info.downloadsMonthly;
    if (downloadsMonthly === null && info.downloadsMonthlyRaw90d !== undefined && info.downloadsMonthlyRaw90d !== null) {
      downloadsMonthly = Math.round(info.downloadsMonthlyRaw90d / 3);
    }

    const row = analyze({
      name: target.name,
      version: info.version ?? target.versions.get(target.name) ?? null,
      ecosystem: target.ecosystem,
      kind: target.direct ? 'direct' : 'transitive',
      lastPublish: info.lastPublish ?? undefined,
      deprecated: info.deprecated,
      deprecationReason: info.deprecationReason ?? undefined,
      maintainers: info.maintainers ?? undefined,
      hasRepository: info.hasRepository ?? undefined,
      repository: info.repository ?? undefined,
      registry: info.registry ?? undefined,
      downloadsMonthly: downloadsMonthly ?? undefined,
      dependents: info.dependents ?? undefined,
      now,
    });
    rows.push(row);
  });

  // --- 2. gecis: indirme sayilari ---
  // Skor ve durum indirme sayisina bagli degil, sadece raporun
  // kapanisindaki "hala indiriliyor mu" sansuru icin gerekiyor.
  //
  // npm: TEK toplu istek (90 paket kadar). Tek tek sormak 429 yiyor —
  //      olcum: dakikada ~40 istekten sonra Cloudflare kilitlemesi.
  // PyPI: pypistats yalnizca sorunlu gozuken paketler icin sorulur.
  const npmRows = rows.filter(
    (r) => r.ecosystem === 'npm' && r.status !== 'unknown' && r.downloadsMonthly === null
  );
  if (npmRows.length) {
    if (onProgress) onProgress(0, 1, 'downloads');
    const counts = await npmDownloadsBulk(
      npmRows.map((r) => r.name),
      deps
    );
    for (const row of npmRows) {
      const n = counts.get(row.name);
      if (n !== undefined) row.downloadsMonthly = n;
    }
    if (onProgress) onProgress(1, 1, 'downloads');
  }

  const pypiTargets = rows.filter(
    (r) =>
      r.ecosystem === 'pypi' &&
      r.status !== 'healthy' &&
      r.status !== 'unknown' &&
      r.downloadsMonthly === null
  );
  if (pypiTargets.length) {
    await mapPool(
      pypiTargets,
      Math.min(4, concurrency),
      async (row) => {
        const dl = await pypiDownloads(row.name, deps);
        if (dl !== null) row.downloadsMonthly = dl;
        return dl;
      },
      (d, totalN) => {
        if (onProgress) onProgress(d, totalN, `downloads ${d}/${totalN}`);
      }
    );
  }

  const cacheStats = cache.stats();

  return {
    rows,
    meta: {
      root,
      projects: projects.length,
      ecosystemFiles: projects.map((p) => ({ ecosystem: p.ecosystem, dir: p.dir })),
      durationMs: Date.now() - started,
      directCount,
      transitiveCount,
      total: rows.length,
      notFound,
      cache: cacheStats,
      cacheHits: cacheStats.hits,
      concurrency,
    },
  };
}

export { detect, Cache, analyze };
export { renderText, renderJson, renderCompact } from './report.js';
export { STATUS_ORDER, summarize, blastRadius, bySeverity } from './score.js';
