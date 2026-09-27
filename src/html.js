/**
 * HTML raporu — tarayicida acilan tek dosyalik "GUI".
 *
 * Kural: dosya kendine yetiyor. Stil, script ve logo dosyanin icinde;
 * `report.html`'i disa aktarip internetsiz de, e-postaya iliştirerek de
 * acabilirsiniz. Harici istek yok — linkler var, yukleme yok.
 *
 * Amaç metin raporunu degil, tamamlamak: metin 3 saniyede okunur, HTML
 * paylasilir (ekibe, PR'a, e-postaya) ve "su pakete tiklayayim" diye
 * gezer.
 */

import { summarize, blastRadius, bySeverity, humanAge, humanCount } from './score.js';
import { nextSteps } from './report.js';
import { logoSvg } from './logo.js';

const STATUS_LABEL = {
  dead: 'DEAD',
  unmaintained: 'UNMAINTAINED',
  stale: 'STALE',
  healthy: 'HEALTHY',
  unknown: 'UNKNOWN',
};

/** HTML metni/ozelligi kacirma — paket adinda `<script>` bile olsa guvenli. */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : null);

function scoreClass(score) {
  if (score === null || score === undefined) return 'na';
  if (score >= 75) return 'hi';
  if (score >= 50) return 'mid';
  return 'lo';
}

function facts(row) {
  const parts = [];
  if (row.downloadsMonthly) parts.push(`${humanCount(row.downloadsMonthly)}/mo downloads`);
  if (row.lastPublishDays !== null && row.lastPublishDays !== undefined) {
    parts.push(`last publish ${humanAge(row.lastPublishDays)} ago`);
  }
  if (row.maintainers === 0) parts.push('no maintainers');
  else if (row.maintainers === 1) parts.push('single maintainer');
  else if (row.maintainers !== null && row.maintainers !== undefined) parts.push(`${row.maintainers} maintainers`);
  if (row.hasRepository === false) parts.push('no repository link');
  parts.push(row.kind === 'direct' ? 'direct dependency' : 'transitive dependency');
  return parts;
}

function packageCard(row) {
  const st = STATUS_LABEL[row.status] ?? 'UNKNOWN';
  const href = row.registry || row.repository || null;
  const name = esc(row.name);
  const nameHtml = href
    ? `<a class="nm" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : `<span class="nm">${name}</span>`;
  const score = row.score ?? null;
  const scoreHtml =
    score === null || score === undefined
      ? `<span class="score na" title="no score">—</span>`
      : `<span class="score sc-${scoreClass(score)}" title="score ${score}/100">${score}</span>`;

  const factsText = facts(row).join('  ·  ');
  const reasons = (row.reasons ?? [])
    // npm mesaji asagidaki kutuda zaten tam haliyle duruyor...
    .filter((r) => !(row.deprecated && r.startsWith('npm: ')))
    // ...geri kalan da facts satirinda geciyorsa listeyi uzatmasin.
    .filter((r) => !factsText.toLowerCase().includes(String(r).toLowerCase()))
    .map((r) => `<li>${esc(r)}</li>`)
    .join('');
  const deprecation = row.deprecated
    ? `<p class="depr">npm says: ${esc(String(row.deprecationReason ?? 'deprecated'))}</p>`
    : '';

  return `      <li class="pkg ${esc(row.status)}" data-status="${esc(row.status)}" data-name="${name.toLowerCase()}">
        <div class="top">
          <span class="st">${st}</span>
          ${nameHtml}${row.version ? `<span class="ver">@${esc(row.version)}</span>` : ''}
          <span class="eco">${esc(row.ecosystem)}</span>
          ${scoreHtml}
        </div>
        <div class="meter"><i class="sc-${scoreClass(score)}" style="width:${score ?? 0}%"></i></div>
        <p class="facts">${esc(factsText)}</p>
        ${reasons ? `<ul class="why">${reasons}</ul>` : ''}
        ${deprecation}
      </li>`;
}

/**
 * Tek dosyalik HTML raporu.
 *
 * @param {{rows?: object[], meta?: object, version?: string|null,
 *          generatedAt?: string}} opts
 * @returns {string}
 */
export function renderHtml(opts = {}) {
  const { rows = [], meta = {}, version = null } = opts;
  const sorted = [...rows].sort(bySeverity);
  const summary = summarize(sorted);
  const blast = blastRadius(sorted);
  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  const counts = ['dead', 'unmaintained', 'stale', 'healthy', 'unknown'].map((k) => ({
    key: k,
    label: STATUS_LABEL[k],
    n: summary[k] ?? 0,
  }));

  const ecosystems = [...new Set(sorted.map((r) => r.ecosystem))].filter(Boolean);
  const metaChips = [
    `<span class="chip">${num(summary.total) ?? 0} packages</span>`,
    `<span class="chip">${num(meta.directCount ?? 0)} direct · ${num(meta.transitiveCount ?? 0)} transitive</span>`,
    ecosystems.length ? `<span class="chip">${esc(ecosystems.join(' + '))}</span>` : '',
    meta.root ? `<span class="chip">${esc(meta.root)}</span>` : '',
    meta.durationMs ? `<span class="chip">${(meta.durationMs / 1000).toFixed(1)}s</span>` : '',
    version ? `<span class="chip">deaddeps v${esc(version)}</span>` : '',
  ].filter(Boolean);

  const flagged = sorted.filter((r) => r.status === 'dead' || r.status === 'unmaintained');
  const blastHtml =
    blast.packages > 0 && blast.downloads > 0
      ? `      <section class="blast">
        <strong>${humanCount(blast.downloads)} downloads/mo</strong> still flow through
        <strong>${num(blast.packages)}</strong> dead/unmaintained ${blast.packages === 1 ? 'package' : 'packages'} —
        those affect you too.${blast.dependents ? ` <span class="muted">${humanCount(blast.dependents)} packages depend on them</span>` : ''}
      </section>\n`
      : '';

  const empty =
    summary.total === 0
      ? `      <p class="empty">✅ <strong>No dependencies found.</strong> Nothing to check.</p>\n`
      : summary.flagged === 0
        ? `      <p class="empty">✅ <strong>All good.</strong> Every dependency released within the last year.</p>\n`
        : '';

  const next = flagged.length ? nextSteps(flagged) : '';
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="deaddeps${version ? ' v' + esc(version) : ''}">
<title>deaddeps report — ${num(summary.total)} packages</title>
<style>
*{box-sizing:border-box}
:root{
  --bg:#fff;--panel:#f6f8fa;--fg:#1f2328;--muted:#57606a;--line:#d0d7de;--accent:#0969da;
  --dead:#cf222e;--unmaintained:#bc4c00;--stale:#9a6700;--healthy:#1a7f37;--unknown:#57606a;
  --score-hi:#1a7f37;--score-mid:#9a6700;--score-lo:#cf222e;--score-na:#8c959f;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0d1117;--panel:#161b22;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--accent:#58a6ff;
    --dead:#f85149;--unmaintained:#db6d28;--stale:#d29922;--healthy:#3fb950;--unknown:#8b949e;
    --score-hi:#3fb950;--score-mid:#d29922;--score-lo:#f85149;--score-na:#6e7681;
  }
}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 72px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.hero{display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.hero svg{border-radius:22px;flex:none}
h1{font-size:32px;margin:0;letter-spacing:-.6px}
.sub{margin:6px 0 0;color:var(--muted)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chip{font-size:12px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);background:var(--panel);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:26px 0 0}
.card{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:14px 16px}
.card b{display:block;font-size:30px;line-height:1.1;font-variant-numeric:tabular-nums}
.card span{font-size:11px;letter-spacing:.08em;color:var(--muted);font-weight:600}
.card.dead b{color:var(--dead)}.card.unmaintained b{color:var(--unmaintained)}
.card.stale b{color:var(--stale)}.card.healthy b{color:var(--healthy)}.card.unknown b{color:var(--unknown)}
.blast{margin:22px 0 0;padding:14px 16px;border:1px solid var(--dead);border-left-width:4px;border-radius:8px;background:var(--panel)}
.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:26px 0 14px}
#q{flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.f{font:inherit;font-size:13px;padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--muted);cursor:pointer}
.f b{font-variant-numeric:tabular-nums}
.f:hover{border-color:var(--muted)}
.f.on{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.count{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
ul.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.pkg{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--panel)}
.pkg.dead{border-left-color:var(--dead)}
.pkg.unmaintained{border-left-color:var(--unmaintained)}
.pkg.stale{border-left-color:var(--stale)}
.pkg.healthy{border-left-color:var(--healthy)}
.pkg.unknown{border-left-color:var(--unknown)}
.top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.st{font-size:10.5px;font-weight:700;letter-spacing:.07em;padding:2px 7px;border-radius:5px;border:1px solid currentColor;background:transparent}
.dead .st{color:var(--dead)}.unmaintained .st{color:var(--unmaintained)}.stale .st{color:var(--stale)}
.healthy .st{color:var(--healthy)}.unknown .st{color:var(--unknown)}
.nm{font-weight:650;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14.5px;word-break:break-all}
.ver{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:var(--muted)}
.eco{font-size:11px;color:var(--muted);border:1px dashed var(--line);border-radius:5px;padding:1px 6px}
.score{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums;font-size:14px}
.sc-hi{color:var(--score-hi)}.sc-mid{color:var(--score-mid)}.sc-lo{color:var(--score-lo)}.sc-na{color:var(--score-na)}
.meter{height:4px;background:var(--line);border-radius:99px;margin:9px 0 8px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:99px;background:currentColor}
.meter i.sc-hi{background:var(--score-hi)}.meter i.sc-mid{background:var(--score-mid)}
.meter i.sc-lo{background:var(--score-lo)}.meter i.sc-na{background:var(--score-na)}
.facts{margin:0;color:var(--muted);font-size:13px}
.why{margin:8px 0 0;padding:0 0 0 18px;font-size:13px;color:var(--muted)}
.why li{margin:1px 0}
.depr{margin:8px 0 0;font-size:13px;padding:7px 10px;border-radius:6px;background:var(--bg);border:1px dashed var(--line);color:var(--dead);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-word}
.empty{padding:22px;border:1px dashed var(--line);border-radius:10px;text-align:center;color:var(--muted)}
footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
footer p{margin:6px 0}
.muted{color:var(--muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:1px 5px}
@media print{
  body{background:#fff}
  .controls{display:none}
  .pkg{break-inside:avoid}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    ${logoSvg({ width: 96 })}
    <div>
      <h1>deaddeps</h1>
      <p class="sub">Find dead, unmaintained and stale dependencies before they find you.</p>
      <div class="chips">${metaChips.join('')}</div>
    </div>
  </header>

  <section class="cards">
${counts.map((c) => `    <div class="card ${c.key}"><b>${c.n}</b><span>${c.label}</span></div>`).join('\n')}
  </section>

${blastHtml}${empty}
  <div class="controls">
    <input id="q" type="search" placeholder="filter packages…" aria-label="filter packages" autocomplete="off">
    <div class="filters" role="group" aria-label="filter by status">
      <button type="button" class="f on" data-f="all">all <b>${summary.total}</b></button>
${counts
  .filter((c) => c.n > 0 && c.key !== 'unknown')
  .map((c) => `      <button type="button" class="f" data-f="${c.key}">${c.label.toLowerCase()} <b>${c.n}</b></button>`)
  .join('\n')}
    </div>
    <span class="count" id="count">${summary.total}</span>
  </div>

  <ul class="list" id="list">
${sorted.map(packageCard).join('\n')}
  </ul>

  <footer>
    <p>Generated ${esc(generatedAt)}${meta.durationMs ? ` in ${(meta.durationMs / 1000).toFixed(1)}s` : ''}${
      next ? ` · next: <code>${esc(next)}</code>` : ''
    } · in CI: <code>deaddeps --fail-on dead</code></p>
    <p class="muted">Status is the <strong>latest</strong> release date: &gt;4 years DEAD · &gt;2 years UNMAINTAINED ·
    &gt;1 year STALE · otherwise HEALTHY · <code>deprecated</code>/<code>yanked</code> = DEAD.
    Score = 100 − age − bus factor − missing repository; deprecated is always 0.</p>
    <p class="muted">deaddeps${version ? ` v${esc(version)}` : ''} · MIT ·
      <a href="https://github.com/RetroNyym/deaddeps">github.com/RetroNyym/deaddeps</a> ·
      no dependencies, no API keys, no telemetry.</p>
  </footer>
</div>
<script>
(function () {
  var items = [].slice.call(document.querySelectorAll('.pkg'));
  var q = document.getElementById('q');
  var count = document.getElementById('count');
  var chips = [].slice.call(document.querySelectorAll('.f'));
  var status = 'all';
  function apply() {
    var term = (q && q.value ? q.value : '').toLowerCase().trim();
    var shown = 0;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var okS = status === 'all' || el.getAttribute('data-status') === status;
      var okT = !term || el.getAttribute('data-name').indexOf(term) !== -1;
      var vis = okS && okT;
      el.style.display = vis ? '' : 'none';
      if (vis) shown++;
    }
    if (count) count.textContent = shown;
  }
  if (q) q.addEventListener('input', apply);
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      status = c.getAttribute('data-f');
      chips.forEach(function (o) { o.classList.toggle('on', o === c); });
      apply();
    });
  });
})();
</script>
</body>
</html>
`;
  return doc;
}
