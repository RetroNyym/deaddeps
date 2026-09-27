/**
 * Ag katmani: retry, eszamanlilik havuzu ve disk onbellegi.
 *
 * Sifir bagimlilik: global `fetch` (Node 18+) ve node:crypto kullanilir.
 *
 * Tasarim kararlarinin gerekcesi:
 *  - Registry'ler zaman zaman 429/500 dondurur; kisa exponential backoff
 *    bir-bagimlilik-araci-arac taramasini dayaniksiz yapmamali.
 *  - Disk onbellegi ikinci calismayi aninda yapar ve cevrimdisi calismayi
 *    mumkun kilar. Tum ambar boyunca tek bir cevrimdisi tarama mumkundur.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;

/** Kullanici aracina gore onbellek dizini secer. */
export function defaultCacheDir() {
  if (process.env.DEADDEPS_CACHE_DIR) return process.env.DEADDEPS_CACHE_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, 'deaddeps', 'cache');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'deaddeps');
  }
  const base = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(base, 'deaddeps');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cache {
  /**
   * @param {{dir?: string, ttlMs?: number, enabled?: boolean}} opts
   */
  constructor({ dir = defaultCacheDir(), ttlMs = 7 * 24 * 3600 * 1000, enabled = true } = {}) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    this.enabled = enabled;
    this.hits = 0;
    this.misses = 0;
    this._ready = false;
  }

  _file(key) {
    const h = createHash('sha1').update(key).digest('hex');
    return path.join(this.dir, h.slice(0, 2), h + '.json');
  }

  _ensureDir() {
    if (this._ready) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this._ready = true;
    } catch {
      // onbellek yazilamiyorsa sessizce devam et; arac calismaya devam eder
      this.enabled = false;
      this._ready = true;
    }
  }

  get(key, { ttlMs = this.ttlMs } = {}) {
    if (!this.enabled) return undefined;
    const file = this._file(key);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const entry = JSON.parse(raw);
      if (Date.now() - entry.at > ttlMs) {
        this.misses++;
        return undefined;
      }
      this.hits++;
      return entry.value;
    } catch {
      this.misses++;
      return undefined;
    }
  }

  set(key, value) {
    if (!this.enabled) return;
    this._ensureDir();
    const file = this._file(key);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ at: Date.now(), value }));
    } catch {
      // yazma hatasi onemli degil
    }
  }

  stats() {
    return { hits: this.hits, misses: this.misses, dir: this.dir, enabled: this.enabled };
  }
}

/**
 * govdeyi okur. `maxBytes` verilirse tavan asilir asilmaz okumayi keser.
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
async function readText(res, maxBytes) {
  if (!maxBytes || !res.body) {
    return { text: await res.text(), truncated: false };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const before = total;
    total += value.length;
    if (total > maxBytes) {
      const keep = Math.max(0, maxBytes - before);
      if (keep > 0) chunks.push(value.subarray(0, keep));
      try { await reader.cancel(); } catch { /* yeterli */ }
      return { text: Buffer.concat(chunks).toString('utf8'), truncated: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

/**
 * HTTP GET + JSON parse. Donus degerleri:
 *   - `null`     -> bulunamadi (404), gecersiz JSON ya da yeniden denemeler
 *                   tukendikten sonra hala basarisiz
 *   - `undefined`-> govde `maxBytes` tavanini asti (cok buyuk dokuman)
 *   - veri       -> basarili
 *
 * Yuksek seviyeli kod hata yonetimiyle ugrasmasin diye hata firlatilmaz;
 * yalnizca ag seviyesindeki sorunlar yinelemeli denenir.
 *
 * @param {string} url
 * @param {{headers?: Record<string,string>, timeoutMs?: number, retries?: number,
 *          cache?: Cache, cacheTtlMs?: number, signal?: AbortSignal,
 *          maxBytes?: number}} [opts]
 * @returns {Promise<any|null|undefined>}
 */
/** Isteklerde kim oldugumuzu soyleyen baslik (kayitlar seffaf kalsin diye). */
export const USER_AGENT = `deaddeps/1.0.0 (+https://github.com/RetroNyym/deaddeps)`;

export async function getJson(url, opts = {}) {
  const {
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    cache,
    cacheTtlMs,
    signal,
  } = opts;

  if (cache) {
    const hit = cache.get(url, { ttlMs: cacheTtlMs });
    if (hit !== undefined) return hit;
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 404) {
        // var olmayan paket bir hata degil, veri
        if (cache) cache.set(url, null);
        return null;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 20_000)
          : 300 * 2 ** attempt;
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        return null;
      }

      if (!res.ok) return null;

      const { text, truncated } = await readText(res, opts.maxBytes);
      if (truncated) return undefined; // cok buyuk; onbellege de almıyoruz

      // Registry bazen HTML hata sayfasi dondurur; JSON disi her sey veri sayilmaz
      const trimmed = text.trimStart();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return null;
      }
      if (cache) cache.set(url, data);
      return data;
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        lastErr = err;
      } else {
        lastErr = err;
      }
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      return null;
    }
  }
  void lastErr;
  return null;
}

/**
 * Dizi uzerinde sinirli eszamanlilikla islem calistirir.
 * Sira korunur; hatalar worker tarafinda yutulmali (worker hata firlatirsa
 * sonuc `undefined` olur).
 *
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<(R|undefined)[]>}
 */
export async function mapPool(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  async function run() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch {
        results[i] = undefined;
      }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return results;
}
