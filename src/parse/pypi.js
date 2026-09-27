/**
 * Python (PyPI) manifest ayrastiricilari.
 *
 * Desteklenenler:
 *   - requirements.txt  (PEP 508 satirlari, devam satirlari, hash'ler, marker'lar)
 *   - pyproject.toml     ([project].dependencies, [project.optional-dependencies],
 *                         [tool.poetry.dependencies])
 */

import { parse as parseToml } from './toml-lite.js';

/** PEP 503 ad normalize etme: kucuk harf, `-_.` tekrarlarini `-` yapar. */
export function normalizeName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

/**
 * PEP 508 ifadesinden paket adini cikarir.
 * `foo[extra]>=1.0; python_version < "3.9"` -> `foo`
 * @param {string} spec
 * @returns {string|null}
 */
export function nameFromRequirement(spec) {
  let s = String(spec).trim();
  if (!s) return null;
  // ortam marker'ini ayir
  const semi = s.indexOf(';');
  if (semi !== -1) s = s.slice(0, semi).trim();
  // URL/yerel girdileri atla
  if (/^(https?|git|file|ssh):/i.test(s)) return null;
  if (s.startsWith('-')) return null;
  // extras
  const bracket = s.indexOf('[');
  if (bracket !== -1) s = s.slice(0, bracket);
  // surum kisitlayicisi
  const specStart = s.search(/[<>=!~\s]/);
  if (specStart !== -1) s = s.slice(0, specStart);
  s = s.trim().replace(/["']/g, '');
  if (!s || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) return null;
  return normalizeName(s);
}

/**
 * requirements.txt -> dogrudan bagimliliklar
 * @param {string} text
 * @returns {{name: string, raw: string}[]}
 */
export function parseRequirements(text) {
  const out = [];
  const seen = new Set();

  // devam satirlarini birlestir (BOM varsa kaldir)
  const joined = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/);

  for (const rawLine of joined) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    // `-r diger.txt`, `-e .`, `--index-url` gibi yonlendirmeler
    if (line.startsWith('-')) continue;
    // `--hash=...` artiklari
    line = line.replace(/\s+--hash=\S+/g, '').trim();
    if (!line) continue;

    const name = nameFromRequirement(line);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    // Tam pin (`pkg==1.2.3`) kurulu surumdur; surumun yayin tarihine
    // bakabilmek icin ayristirilir. Aralik (`>=`, `~`) surum degildir.
    const pin = line.match(/^\s*[A-Za-z0-9._-]+\s*(?:\[[^\]]*\])?\s*==\s*([^\s;#]+)/);
    out.push({ name, raw: line, version: pin ? pin[1].replace(/["']/g, '') : null });
  }
  return out;
}

/**
 * pyproject.toml -> dogrudan bagimliliklar (PEP 621 + Poetry)
 * @param {string} text
 */
export function parsePyproject(text) {
  let doc;
  try {
    doc = parseToml(text);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const name = nameFromRequirement(typeof raw === 'string' ? raw : String(raw?.name ?? ''));
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, raw: typeof raw === 'string' ? raw : String(raw?.name ?? '') });
  };

  // PEP 621
  const project = doc?.project;
  if (project && typeof project === 'object') {
    if (Array.isArray(project.dependencies)) project.dependencies.forEach(push);
    const optional = project['optional-dependencies'];
    if (optional && typeof optional === 'object') {
      for (const list of Object.values(optional)) {
        if (Array.isArray(list)) list.forEach(push);
      }
    }
  }

  // Poetry
  const poetryDeps = doc?.tool?.poetry?.dependencies;
  if (poetryDeps && typeof poetryDeps === 'object') {
    for (const [name, value] of Object.entries(poetryDeps)) {
      if (name.toLowerCase() === 'python') continue;
      if (typeof value === 'string') push(name);
      else if (value && typeof value === 'object' && value.git) continue;
      else if (value && typeof value === 'object' && value.path) continue;
      else push(name);
    }
  }
  const poetryGroups = doc?.tool?.poetry?.['group'];
  if (poetryGroups && typeof poetryGroups === 'object') {
    for (const group of Object.values(poetryGroups)) {
      const deps = group?.dependencies;
      if (deps && typeof deps === 'object') {
        for (const name of Object.keys(deps)) push(name);
      }
    }
  }
  const poetryDev = doc?.tool?.poetry?.['dev-dependencies'];
  if (poetryDev && typeof poetryDev === 'object') Object.keys(poetryDev).forEach(push);

  return out;
}
