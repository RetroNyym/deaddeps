/**
 * Rapor ureteci — urunun yuzu.
 *
 * Bir bağımlilik aracinin kaderi ekranda gosterdigi seye baglidir:
 * okunmasi 3 saniye surmeli, "simdiden ne yapmam gerek" sorusunu
 * cevaplamali ve paylasildiginda anlasilmali.
 *
 * Cikt bicimleri: metin (varsayilan), json.
 */

import {
  STATUS_META,
  STATUS_ORDER,
  humanAge,
  humanCount,
  summarize,
  blastRadius,
  bySeverity,
} from './score.js';
import {
  bold,
  dim,
  red,
  yellow,
  green,
  cyan,
  gray,
  italic,
  padEndWidth,
  padStartWidth,
  truncateWidth,
} from './colors.js';

const STATUS_COLOR = { dead: red, unmaintained: yellow, stale: yellow, healthy: green, unknown: gray };
const STATUS_EMOJI = {
  dead: '\u{1F480}',
  unmaintained: '\u{1F7E0}',
  stale: '\u{1F7E1}',
  healthy: '\u2705',
  unknown: '\u2753',
};

const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : null);

function metrics(row) {
  const parts = [];
  if (row.downloadsMonthly) {
    const d = humanCount(row.downloadsMonthly);
    if (d) parts.push(`${d}/mo downloads`);
  }
  if (row.dependents !== null && row.dependents !== undefined) {
    parts.push(`${humanCount(row.dependents)} dependents`);
  }
  if (row.lastPublishDays !== null && row.lastPublishDays !== undefined) {
    parts.push(`last publish ${humanAge(row.lastPublishDays)} ago`);
  }
  if (row.maintainers !== null && row.maintainers !== undefined) {
    parts.push(
      row.maintainers === 0
        ? 'no maintainers'
        : row.maintainers === 1
          ? 'single maintainer'
          : `${row.maintainers} maintainers`
    );
  }
  return parts.join('  \u00b7  ');
}

// Ekosisteme gore "simdiden ne yapmali" ipucu.
const NEXT_HINTS = {
  npm: 'npm audit  \u00b7  npm outdated',
  pypi: 'pip-audit  \u00b7  pip list --outdated',
  cargo: 'cargo audit  \u00b7  cargo update --dry-run',
};

/** Bildirilen paketlerin ekosistemlerine gore kisa bir sonraki-adim satiri. */
function nextSteps(rows) {
  const seen = new Set(rows.map((r) => r.ecosystem));
  return [...seen].map((eco) => NEXT_HINTS[eco] ?? 'npm audit').join('  \u00b7  ');
}

function sectionHeader(label, count, emoji) {
  const color = STATUS_COLOR[label.toLowerCase()] ?? gray;
  return `\n${bold(color(`${emoji} ${label} (${count})`))}`;
}

/**
 * Varsayilan metin ciktisinda listeleri ust sinirlar.
 *
 * 150 bagimlilikli bir projede DEAD listesinin 61 satira cikmasi
 * raporu okunmaz hale getiriyor; asil soru "kac tane var" ve
 * "ilk birkaci kim" — gerisi `--json`'da.
 */
const LIST_LIMITS = { dead: 15, unmaintained: 10, stale: 10, healthy: 12 };

function cap(list, status) {
  const limit = LIST_LIMITS[status];
  if (!limit || list.length <= limit) return { shown: list, hidden: 0 };
  return { shown: list.slice(0, limit), hidden: list.length - limit };
}

function moreLine(hidden) {
  return `    ${dim(`… +${hidden} more — full list: deaddeps --json`)}`;
}

/**
 * Insan icin metin raporu.
 *
 * @param {{rows: object[], meta: object, showHealthy?: boolean,
 *          width?: number, color?: boolean}} opts
 * @returns {string}
 */
export function renderText(opts) {
  const { rows, meta = {}, showHealthy = false } = opts;
  const out = [];

  const sorted = [...rows].sort(bySeverity);
  const summary = summarize(sorted);
  const width = opts.width ?? 100;

  // --- baslik ---
  const ecosystems = [...new Set(sorted.map((r) => r.ecosystem))].filter(Boolean).join(' + ');
  out.push(
    `${bold('deaddeps')}  ${dim('finds dead, rotten and unmaintained dependencies')}`
  );
  const header = [
    `${num(summary.total)} packages  ` +
      `(${num(meta.directCount ?? 0)} direct, ${num(meta.transitiveCount ?? 0)} transitive)`,
    ecosystems,
    meta.durationMs ? `${(meta.durationMs / 1000).toFixed(1)}s` : '',
    meta.cacheHits ? `${meta.cacheHits} cached` : '',
  ].filter(Boolean);
  out.push(dim(header.join('  \u00b7  ')));

  // --- ozet sayaclari ---
  const sep = '   ' + dim('\u00b7') + '   ';
  const line = [
    `${STATUS_EMOJI.dead} ${bold(red(summary.dead))} DEAD`,
    `${STATUS_EMOJI.unmaintained} ${yellow(summary.unmaintained)} UNMAINTAINED`,
    `${STATUS_EMOJI.stale} ${yellow(summary.stale)} STALE`,
    `${STATUS_EMOJI.healthy} ${green(summary.healthy)} HEALTHY`,
  ];
  if (summary.unknown) line.push(`${STATUS_EMOJI.unknown} ${gray(summary.unknown)} UNKNOWN`);
  out.push('\n  ' + line.join(sep));

  // --- DEAD ---
  const deadAll = sorted.filter((r) => r.status === 'dead');
  if (deadAll.length) {
    const { shown: dead, hidden } = cap(deadAll, 'dead');
    out.push(sectionHeader('DEAD', deadAll.length, STATUS_EMOJI.dead));
    for (const row of dead) {
      const title = `${bold(STATUS_COLOR.dead(row.name))}${row.version ? dim(`@${row.version}`) : ''}`;
      out.push(`  ${title}`);
      if (row.deprecationReason) {
        const msg = row.deprecationReason.replace(/\s+/g, ' ');
        out.push(`    ${italic(yellow('npm:'))} ${gray(truncateWidth(msg, width - 8))}`);
      }
      const m = metrics(row);
      if (m) out.push(`    ${cyan(m)}`);
    }
    if (hidden) out.push(moreLine(hidden));
  }

  // --- UNMAINTAINED ---
  const unAll = sorted.filter((r) => r.status === 'unmaintained');
  if (unAll.length) {
    const { shown: un, hidden } = cap(unAll, 'unmaintained');
    out.push(sectionHeader('UNMAINTAINED', unAll.length, STATUS_EMOJI.unmaintained));
    const nameW = Math.min(38, Math.max(...un.map((r) => (r.name + (r.version ? '@' + r.version : '')).length)));
    for (const row of un) {
      const label = row.name + (row.version ? '@' + row.version : '');
      out.push(
        `  ${STATUS_EMOJI.unmaintained} ${padEndWidth(yellow(label), nameW)}  ${cyan(metrics(row))}`
      );
    }
    if (hidden) out.push(moreLine(hidden));
  }

  // --- STALE ---
  const staleAll = sorted.filter((r) => r.status === 'stale');
  if (staleAll.length) {
    const { shown: stale, hidden } = cap(staleAll, 'stale');
    out.push(sectionHeader('STALE', staleAll.length, STATUS_EMOJI.stale));
    const nameW = Math.min(38, Math.max(...stale.map((r) => (r.name + (r.version ? '@' + r.version : '')).length)));
    for (const row of stale) {
      const label = row.name + (row.version ? '@' + row.version : '');
      const age = row.lastPublishDays !== null ? `last publish ${humanAge(row.lastPublishDays)} ago` : '';
      const dl = row.downloadsMonthly ? `${humanCount(row.downloadsMonthly)}/mo` : '';
      out.push(
        `  ${STATUS_EMOJI.stale} ${padEndWidth(yellow(label), nameW)}  ${dim([age, dl].filter(Boolean).join('  \u00b7  '))}`
      );
    }
    if (hidden) out.push(moreLine(hidden));
  }

  // --- UNKNOWN ---
  const unknown = sorted.filter((r) => r.status === 'unknown');
  if (unknown.length && meta.showUnknown) {
    out.push(sectionHeader('UNKNOWN', unknown.length, STATUS_EMOJI.unknown));
    for (const row of unknown) out.push(`  ${gray(`${row.name}@${row.version ?? '?'}`)}`);
  }

  // --- HEALTHY (yalnizca istenirse) ---
  if (showHealthy) {
    const healthyAll = sorted.filter((r) => r.status === 'healthy');
    if (healthyAll.length) {
      const { shown: healthy, hidden } = cap(healthyAll, 'healthy');
      out.push(sectionHeader('HEALTHY', healthyAll.length, STATUS_EMOJI.healthy));
      const nameW = Math.min(38, Math.max(...healthy.map((r) => r.name.length)));
      for (const row of healthy) {
        out.push(`  ${STATUS_EMOJI.healthy} ${padEndWidth(green(row.name), nameW)}  ${dim(metrics(row))}`);
      }
      if (hidden) out.push(moreLine(hidden));
    }
  }

  // --- asil sansur: olu paketler hala indiriliyor mu? ---
  const blast = blastRadius(sorted);
  out.push('');
  if (blast.packages > 0 && blast.downloads > 0) {
    const n = num(blast.packages);
    const word = blast.packages === 1 ? 'package' : 'packages';
    out.push(
      `  ${bold(red('\u26a0'))} ${bold(`${humanCount(blast.downloads)} downloads/mo`)} ` +
        `${dim('still flow through ')}${bold(red(n))}${dim(` dead/unmaintained ${word} \u2014 those affect you too.`)}`
    );
    if (blast.dependents) {
      out.push(`    ${dim(`${humanCount(blast.dependents)} packages depend on them`)}`);
    }
  } else if (summary.total === 0) {
    out.push(`  ${green('\u2705')} ${bold('No dependencies found.')} ${dim('Nothing to check.')}`);
  } else if (summary.flagged === 0) {
    out.push(`  ${green('\u2705')} ${bold('All good.')} ${dim('Every dependency released within the last year.')}`);
  }

  // --- sonraki adim ipucu (ekosisteme gore) ---
  if (summary.dead > 0 || summary.unmaintained > 0) {
    out.push('');
    const flagged = sorted.filter((r) => r.status === 'dead' || r.status === 'unmaintained');
    out.push(dim(`  next: ${nextSteps(flagged)}  \u00b7  in CI: deaddeps --fail-on dead`));
  }

  return out.join('\n') + '\n';
}

/** Agirlikli kisa ozet (CI loglari, Slack bildirimleri icin tek satir). */
export function renderCompact(rows) {
  const summary = summarize(rows);
  const blast = blastRadius(rows);
  const parts = [
    `${STATUS_EMOJI.dead} ${summary.dead}`,
    `${STATUS_EMOJI.unmaintained} ${summary.unmaintained}`,
    `${STATUS_EMOJI.stale} ${summary.stale}`,
    `${STATUS_EMOJI.healthy} ${summary.healthy}`,
  ];
  let s = `deaddeps: ${summary.total} packages \u2192 ${parts.join(' / ')}`;
  if (blast.downloads) s += ` \u00b7 ${humanCount(blast.downloads)}/mo from dead packages`;
  return s;
}

/** Makine icin JSON raporu. */
export function renderJson(rows, meta = {}) {
  const summary = summarize(rows);
  const sorted = [...rows].sort(bySeverity);
  return JSON.stringify(
    {
      tool: 'deaddeps',
      version: meta.version ?? null,
      generatedAt: new Date().toISOString(),
      durationMs: meta.durationMs ?? null,
      summary,
      blastRadius: blastRadius(rows),
      thresholds: meta.thresholds ?? undefined,
      packages: sorted.map((r) => ({
        name: r.name,
        version: r.version,
        ecosystem: r.ecosystem,
        kind: r.kind,
        status: r.status,
        score: r.score,
        lastPublish: r.lastPublish,
        lastPublishDays: r.lastPublishDays,
        deprecated: r.deprecated,
        deprecationReason: r.deprecationReason,
        maintainers: r.maintainers,
        repository: r.repository,
        registry: r.registry,
        downloadsMonthly: r.downloadsMonthly,
        dependents: r.dependents,
        reasons: r.reasons,
      })),
    },
    null,
    2
  );
}

export { STATUS_ORDER, STATUS_META, padStartWidth };
