/**
 * TOML-lite: Cargo.toml / Cargo.lock / pyproject.toml okumak icin
 * minumum bir TOML ayrastirici.
 *
 * Tam TOML ozelligini (tarihler, cok katmanli satir arasi ifadeler)
 * desteklemiyor — bilincli olarak. Amac kagit uzerindeki bagimlilik
 * listesini cikarmak; tam dogruluk yerine "hictirmemek" tercih edildi:
 * ayrastirma basarisiz olursa yonlendirici bos listeyle devam eder.
 */

/** Dizi/ic tablo icin parantez dengesini bulur (tirnaklari gozardi eder). */
function findBalanceEnd(s, start, open, close) {
  let depth = 0;
  let inStr = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseString(s, i) {
  const q = s[i];
  // cok satirli tirnak
  if (s[i] === q && s[i + 1] === q && s[i + 2] === q) {
    const end = s.indexOf(q + q + q, i + 3);
    if (end === -1) return { value: s.slice(i + 3), end: s.length };
    return { value: s.slice(i + 3, end), end: end + 3 };
  }
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      const n = s[j + 1];
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
      out += map[n] ?? n ?? '';
      j++;
      continue;
    }
    if (c === q) return { value: out, end: j + 1 };
    out += c;
  }
  return { value: out, end: s.length };
}

function parseValue(s) {
  const t = s.trim();
  if (t === '') return '';
  if (t[0] === '"' || t[0] === "'") return parseString(t, 0).value;
  if (t[0] === '[') {
    const end = findBalanceEnd(t, 0, '[', ']');
    const inner = end === -1 ? t.slice(1) : t.slice(1, end);
    return parseArray(inner);
  }
  if (t[0] === '{') {
    const end = findBalanceEnd(t, 0, '{', '}');
    const inner = end === -1 ? t.slice(1) : t.slice(1, end);
    return parseInlineTable(inner);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  const num = Number(t);
  if (!Number.isNaN(num) && /^[-+]?[\d.eE_]+$/.test(t)) return num;
  return t;
}

function parseArray(inner) {
  const items = [];
  let buf = '';
  let depth = 0;
  let inStr = null;
  const push = () => {
    if (buf.trim()) items.push(parseValue(buf));
    buf = '';
  };
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      buf += c;
      if (c === '\\') { buf += inner[i + 1] ?? ''; i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { push(); continue; }
    buf += c;
  }
  push();
  return items;
}

function parseInlineTable(inner) {
  const obj = {};
  //ust seviye virgulleri bol
  const parts = [];
  let buf = '';
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      buf += c;
      if (c === '\\') { buf += inner[i + 1] ?? ''; i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const key = p.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    obj[key] = parseValue(p.slice(eq + 1));
  }
  return obj;
}

function setPath(root, pathParts, value) {
  let cur = root;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const k = pathParts[i];
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) {
      cur[k] = {};
    }
    cur = cur[k];
  }
  const last = pathParts[pathParts.length - 1];
  if (Array.isArray(cur[last])) cur[last].push(value);
  else cur[last] = value;
}

function splitTopLevel(s, sep) {
  const out = [];
  let buf = '';
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      buf += c;
      if (c === '\\') { buf += s[i + 1] ?? ''; i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === sep && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '') out.push(buf);
  return out;
}

function stripComment(line) {
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

/**
 * TOML metnini nesneye cevirir.
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parse(text) {
  const root = {};
  let current = null;

  // cok satirli degerleri tek satirda topla (dizi/ic tablo dengesi)
  // BOM kaldirilir: `[package]` satirinin basindaki U+FEFF bolum
  // basligini tanimlanmaz yapar ve tum bagimliliklar kaybolur.
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    let line = stripComment(lines[i]);
    i++;
    if (!line.trim()) continue;

    const trimmed = line.trim();

    // [bolum] veya [[bolum]]
    if (trimmed.startsWith('[')) {
      const isArray = trimmed.startsWith('[[');
      const inner = trimmed.replace(/^\[\[?/, '').replace(/\]\]?$/, '').trim();
      const parts = splitTopLevel(inner, '.').map((p) => p.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (!parts.length) continue;
      if (isArray) {
        if (!Array.isArray(root[parts[parts.length - 1]])) {
          setPath(root, parts, []);
          root[pathJoin(parts)] = root[parts[parts.length - 1]];
        }
        const arr = getOrCreateArray(root, parts);
        current = {};
        arr.push(current);
      } else {
        current = getOrCreateTable(root, parts);
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    if (!key) continue;
    let valueText = line.slice(eq + 1).trim();

    // Denge kapali degilse alt satirlari tuket
    const needsMore = (t) => {
      if (!t) return false;
      const open = (t.match(/[\[{]/g) || []).length;
      const close = (t.match(/[\]}]/g) || []).length;
      if (open > close) return true;
      const q = (t.match(/"/g) || []).length;
      const q2 = (t.match(/'/g) || []).length;
      return q % 2 !== 0 || q2 % 2 !== 0;
    };
    while (needsMore(valueText) && i < lines.length) {
      valueText += '\n' + stripComment(lines[i]);
      i++;
    }

    const value = parseValue(valueText);
    const target = current ?? root;
    const parts = splitTopLevel(key, '.').map((p) => p.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (parts.length === 1) target[parts[0]] = value;
    else setPath(target, parts, value);
  }

  return root;
}

function pathJoin(parts) {
  return parts.join('.');
}

function getOrCreateTable(root, parts) {
  let cur = root;
  for (const p of parts) {
    if (typeof cur[p] !== 'object' || cur[p] === null || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  return cur;
}

function getOrCreateArray(root, parts) {
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (!Array.isArray(cur[last])) cur[last] = [];
  return cur[last];
}

export { splitTopLevel };
