/**
 * Manifest ve lock dosyalarini bulur.
 *
 * Monorepo'lar hedefleniyor: bir depoda onlarca package.json olabilir.
 * Sonradan ad bazinda birlestirilecegi icin burada hepsi toplanir.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Gecilmemesi gereken dizinler. */
const IGNORE = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.venv',
  'venv',
  '.tox',
  '.nox',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  'coverage',
  '.nyc_output',
  'vendor',
  '.idea',
  '.vscode',
  '.pnpm-store',
  '.yarn',
  '.sass-cache',
  'bower_components',
]);

const NPM_MANIFEST = 'package.json';
const NPM_LOCKS = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'];
const CARGO_MANIFEST = 'Cargo.toml';
const CARGO_LOCK = 'Cargo.lock';

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readIfExists(p) {
  try {
    const text = fs.readFileSync(p, 'utf8');
    // UTF-8 BOM: JSON/TOML ayristiricilarini sessizce devre disi birakir.
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Bir dizindeki requirements*.txt dosyalarini (en cok ortak olani once) bulur. */
function findRequirements(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^requirements[\w.-]*\.txt$/i.test(f))
    .sort((a, b) => {
      const score = (n) => (n.toLowerCase() === 'requirements.txt' ? 0 : 1);
      return score(a) - score(b) || a.localeCompare(b);
    });
}

/**
 * Bir dizini tara.
 * @param {string} root
 * @param {{maxDepth?: number}} [opts]
 * @returns {{dir: string, ecosystem: string, manifest: string,
 *            manifests: string[], lockfiles: string[]}[]}
 */
export function detect(root, { maxDepth = 5 } = {}) {
  const projects = [];
  const absRoot = path.resolve(root);

  /** @param {string} dir @param {number} depth */
  const visit = (dir, depth) => {
    // --- npm ---
    const pkgPath = path.join(dir, NPM_MANIFEST);
    if (exists(pkgPath)) {
      const locks = NPM_LOCKS.map((f) => path.join(dir, f)).filter(exists);
      projects.push({
        dir,
        ecosystem: 'npm',
        manifest: pkgPath,
        manifests: [pkgPath],
        lockfiles: locks,
      });
    }

    // --- pypi ---
    const pyproject = path.join(dir, 'pyproject.toml');
    const requirements = findRequirements(dir);
    if (exists(pyproject) || requirements.length) {
      const manifests = [];
      if (exists(pyproject)) manifests.push(pyproject);
      for (const r of requirements) manifests.push(path.join(dir, r));
      projects.push({
        dir,
        ecosystem: 'pypi',
        manifest: manifests[0],
        manifests,
        lockfiles: [],
      });
    }

    // --- cargo ---
    const cargoPath = path.join(dir, CARGO_MANIFEST);
    if (exists(cargoPath)) {
      const lockPath = path.join(dir, CARGO_LOCK);
      projects.push({
        dir,
        ecosystem: 'cargo',
        manifest: cargoPath,
        manifests: [cargoPath],
        lockfiles: exists(lockPath) ? [lockPath] : [],
      });
    }

    if (depth >= maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORE.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };

  if (!isDirectory(absRoot)) return projects;
  visit(absRoot, 0);
  return projects;
}

export { readIfExists, isDirectory, exists, IGNORE };
