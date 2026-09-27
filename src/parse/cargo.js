/**
 * Rust (crates.io) manifest ve lock ayristiricilari.
 *
 * Desteklenenler:
 *   - Cargo.toml   ([dependencies], [dev-dependencies], [build-dependencies],
 *                   [target.*.dependencies])
 *   - Cargo.lock   (kurulu tum paketler)
 */

import { parse as parseToml } from './toml-lite.js';

/** Bir bolumdeki (dependencies vs.) paket adlarini toplar. */
function collectDeps(section, out, seen) {
  if (!section || typeof section !== 'object') return;
  for (const [name, value] of Object.entries(section)) {
    if (!name || seen.has(name)) continue;
    // yerel yol/git bagimliliklari crates.io'da aranmaz
    if (value && typeof value === 'object') {
      if (value.path) continue;
      if (value.git) continue;
      if (value.workspace) continue;
    }
    seen.add(name);
    out.push({ name, range: typeof value === 'string' ? value : (value?.version ?? null) });
  }
}

/**
 * Cargo.toml -> dogrudan bagimliliklar
 * @param {string} text
 */
export function parseCargoToml(text) {
  let doc;
  try {
    doc = parseToml(text);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();

  collectDeps(doc.dependencies, out, seen);
  collectDeps(doc['dev-dependencies'], out, seen);
  collectDeps(doc['build-dependencies'], out, seen);
  collectDeps(doc?.workspace?.dependencies, out, seen);

  // [target.'cfg(...)'.dependencies]
  const target = doc.target;
  if (target && typeof target === 'object') {
    for (const cfg of Object.values(target)) {
      if (!cfg || typeof cfg !== 'object') continue;
      collectDeps(cfg.dependencies, out, seen);
      collectDeps(cfg['dev-dependencies'], out, seen);
      collectDeps(cfg['build-dependencies'], out, seen);
    }
  }
  return out;
}

/**
 * Cargo.lock -> kurulu tum paketler
 * @param {string} text
 */
export function parseCargoLock(text) {
  const doc = parseToml(text);
  const raw = doc?.package;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  const seen = new Set();
  for (const pkg of list) {
    if (!pkg || typeof pkg !== 'object') continue;
    const name = typeof pkg.name === 'string' ? pkg.name : null;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      version: typeof pkg.version === 'string' ? pkg.version : null,
      source: typeof pkg.source === 'string' ? pkg.source : null,
    });
  }
  // kaynagi olmayanlar (path/workspace paketleri) crates.io'da aranmaz
  return out.filter((p) => !p.source || p.source.startsWith('registry+'));
}
