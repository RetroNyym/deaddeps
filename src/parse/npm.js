/**
 * npm ekosistemi manifest ve lock dosyasi ayrastiricilari.
 *
 * Neden lock dosyasi? Olumlu bagimliliklarin cogu DOGRUDAN
 * bagimlilik degil, TRANSITIFTIR. `package.json`'da 20 satir gorup
 * 400 paket kurmak — sorunun tamami burada.
 *
 * Desteklenenler:
 *   - package.json
 *   - package-lock.json (v1, v2, v3)
 *   - npm-shrinkwrap.json (ayni format)
 *   - yarn.lock (v1 klasik + berry uyumlu)
 *   - pnpm-lock.yaml (iyi niyetli ayristirma; sonuc bossa yonlendirici duser)
 */

/**
 * JSON metni ayristirir. UTF-8 BOM kaldirilir: bazi edit'ler
 * (VS Code varsayilani degil ama Windows'ta yaygin) package.json'in
 * basina U+FEFF koyar; JSON.parse bunu hata sayar ve tum dogrudan
 * bagimliliklar sessizce kaybolur. npm kendisi de bu islemi yapar.
 */
export function parseJson(text) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  return JSON.parse(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
}

const isLocalRef = (obj) => {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.link === true) return true;
  const r = obj.resolved;
  if (typeof r === 'string' && (r.startsWith('file:') || r.startsWith('link:'))) return true;
  const v = obj.version;
  if (typeof v === 'string' && (v.startsWith('file:') || v.startsWith('link:'))) return true;
  return false;
};

/**
 * package.json -> dogrudan bagimliliklar
 * @param {string} text
 * @returns {{name: string, range: string|null, section: string}[]}
 */
export function parsePackageJson(text) {
  let json;
  try {
    json = parseJson(text);
  } catch {
    return [];
  }
  const sections = [
    ['dependencies', 'prod'],
    ['devDependencies', 'dev'],
    ['optionalDependencies', 'optional'],
    // peerDependencies projeye kurulmaz ama lock dosyasinda yer alir;
    // burada yine de listeliyoruz ki "bu paket hala bakim goruyor mu" sorusu
    // proje sahibinin ilgilendigi paketleri kapsasin.
    ['peerDependencies', 'peer'],
  ];
  const out = [];
  for (const [key, section] of sections) {
    const deps = json[key];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof name !== 'string' || !name) continue;
      if (typeof range === 'string' && (range.startsWith('file:') || range.startsWith('link:'))) continue;
      out.push({ name, range: typeof range === 'string' ? range : null, section });
    }
  }
  return out;
}

/** `node_modules/foo` veya `node_modules/a/node_modules/b` -> `foo` / `b` */
function nameFromLockPath(p) {
  const idx = p.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = p.slice(idx + 'node_modules/'.length);
  if (!rest || rest.endsWith('/')) return null;
  return rest;
}

/**
 * package-lock.json / npm-shrinkwrap.json -> kurulu tum paketler
 * @param {string} text
 * @returns {{name: string, version: string|null, dev: boolean, optional: boolean}[]}
 */
export function parsePackageLock(text) {
  let json;
  try {
    json = parseJson(text);
  } catch {
    return [];
  }

  const out = [];
  const seen = new Set();

  const add = (name, version, dev = false, optional = false) => {
    if (!name) return;
    const key = `${name}@${version ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, version: version ?? null, dev: Boolean(dev), optional: Boolean(optional) });
  };

  // v2 / v3
  if (json.packages && typeof json.packages === 'object') {
    for (const [pathKey, entry] of Object.entries(json.packages)) {
      if (pathKey === '') continue; // kok proje
      if (!entry || typeof entry !== 'object') continue;
      const name = nameFromLockPath(pathKey) ?? entry.name;
      if (!name) continue;
      if (isLocalRef(entry)) continue;
      add(name, entry.version, entry.dev, entry.optional);
    }
    return out;
  }

  // v1: ic ice `dependencies`
  const walk = (deps) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, entry] of Object.entries(deps)) {
      if (!entry || typeof entry !== 'object') continue;
      if (isLocalRef(entry)) continue;
      add(name, entry.version, entry.dev, entry.optional);
      if (entry.dependencies) walk(entry.dependencies);
    }
  };
  walk(json.dependencies);
  return out;
}

/**
 * yarn.lock -> kurulu tum paketler.
 * Hem klasik (v1) hem berry (v2+) bicimini kapsayan bilincli bir tarayici.
 * @param {string} text
 */
export function parseYarnLock(text) {
  const out = [];
  const seen = new Set();
  const blocks = String(text).split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    if (!lines.length) continue;
    const header = lines[0];
    if (/^\s/.test(header)) continue; // anahtar degil

    if (!header.endsWith(':')) continue;

    // `"@scope/name@^1.0.0", name@~2.0.0:` -> anahtarlar virgulle ayrilir
    const keys = header.slice(0, -1).split(/,\s*/);
    let name = null;
    for (const rawKey of keys) {
      const k = rawKey.trim().replace(/^"|"$/g, '');
      if (!k) continue;
      // Berry protokolleri: `debug@npm:debug@^4.3.0` (npm alias),
      // `foo@workspace:packages/foo`. Buradaki ad, protokolden ONCESIDIR.
      const proto = k.search(/@(npm|patch|portal|workspace|link|file):/);
      if (proto > 0) {
        name = k.slice(0, proto);
        break;
      }
      // scope'lu: @scope/name@range  -> son @ ayirir
      // scope'suz: name@range       -> son @ ayirir
      const at = k.lastIndexOf('@');
      if (at <= 0) continue;
      name = k.slice(0, at);
      break;
    }
    if (!name) continue;

    let version = null;
    for (const line of lines.slice(1)) {
      // v1: `  version "4.1.2"` (iki nokta yok)
      // berry: `  version: 4.1.2` / `  resolution: "pkg@npm:1.0.0"`
      const m = line.match(/^\s+(?:version|resolution)\s*[:=]?\s*"?([^"\s]+)"?/);
      if (m) {
        version = m[1];
        break;
      }
    }
    const key = `${name}@${version ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, version, dev: false, optional: false });
  }
  return out;
}

/**
 * pnpm-lock.yaml -> kurulu tum paketler (iyi niyetli).
 * YAML kutuphanesi olmadigi icin `packages:` altindaki ANAHTARLAR okunur;
 * diger her sey gozardi edilir. Sonuc bosalrsa yonlendirici devreye girer.
 * @param {string} text
 */
export function parsePnpmLock(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  const seen = new Set();
  let inPackages = false;
  let baseIndent = -1;

  const keyToName = (raw) => {
    let k = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!k) return null;
    // pnpm v6 altinda `/name@1.2.3`, v9 altinda `name@1.2.3`
    if (k.startsWith('/')) k = k.slice(1);
    // peer baglantisi notasyonu: `foo@1.2.3(bar@2.0.0)`
    const paren = k.search(/[(:]/);
    if (paren > 0) k = k.slice(0, paren);
    const at = k.lastIndexOf('@');
    if (at <= 0) return null;
    const name = k.slice(0, at);
    const version = k.slice(at + 1);
    return { name, version };
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^ */)[0].length;

    if (indent === 0) {
      const isPackagesKey = /^(?:packages|snapshots):/.test(line.trim());
      if (isPackagesKey) {
        inPackages = true;
        baseIndent = -1;
      } else {
        inPackages = false;
      }
      continue;
    }

    if (!inPackages) continue;

    // `packages:` altindaki ilk giris seviyesini ogren
    if (baseIndent === -1 || indent === baseIndent) {
      if (baseIndent === -1) baseIndent = indent;
      const m = line.match(/^\s+['"]?([^'":]+?(?:@[^\s:'"]+)?)['"]?\s*:\s*(?:#.*)?$/);
      if (!m) continue;
      const parsed = keyToName(m[1]);
      if (!parsed || !parsed.name) continue;
      const key = `${parsed.name}@${parsed.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: parsed.name, version: parsed.version, dev: false, optional: false });
    }
  }
  return out;
}
