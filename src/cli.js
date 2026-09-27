/**
 * Komut satiri arayuzu.
 *
 * Sifir bagimlilik: arguman ayristirma `node:util`'in parseArgs'ini
 * kullanir (Node 18.3+).
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scan } from './index.js';
import { renderText, renderJson, renderCompact } from './report.js';
import { renderHtml } from './html.js';
import { bannerLines } from './logo.js';
import { bold, dim, red, green, yellow, cyan, gray, enabled as colorEnabled } from './colors.js';

const HELP = `
${bold('deaddeps')} — find dead, unmaintained and stale dependencies.

${bold('USAGE')}
  deaddeps [directory] [options]

${bold('EXAMPLES')}
  ${cyan('deaddeps')}                          scan the current directory
  ${cyan('deaddeps ./api --fail-on dead')}     fail CI when something is dead
  ${cyan('deaddeps --json > report.json')}     machine-readable report
  ${cyan('deaddeps --html report.html')}       visual report to open in a browser
  ${cyan('deaddeps --direct')}                 only the ones you wrote yourself
  ${cyan('deaddeps --compact')}                one-line summary for CI logs

${bold('OPTIONS')}
  --direct              Only direct dependencies (skip transitive ones)
  --json                Produce a JSON report
  --compact             One-line summary output
  --html <file>         Write a self-contained HTML report (logo included)
  --show-healthy        List the healthy packages too
  --fail-on <status>    Exit 1 when a threshold is crossed
                        dead | unmaintained | stale | any
  --min-score <n>       Any package scoring below this is a failure (0-100)
  --concurrency <n>     Parallel requests (default: 16)
  --cache-ttl <days>    Disk cache lifetime (default: 7, 0 = no cache)
  --no-cache            Do not use the disk cache
  --cwd <directory>     Directory to scan (instead of a positional argument)
  --verbose             Show the progress line even when stderr is not a TTY
  -h, --help            Show this help
  -v, --version         Show the version

${bold('CI EXAMPLE')}
  - uses: actions/setup-node@v4
  - run: npx deaddeps --fail-on dead --compact

${bold('STATUSES')}
  ${red('DEAD')}         the publisher said "don't use this", or no release in 4+ years
  ${yellow('UNMAINTAINED')} no release in 2+ years
  ${yellow('STALE')}         no release in 1+ year
  ${green('HEALTHY')}        released within the last year

All thresholds live in src/score.js and are documented in the README.
`;

const EXIT_OK = 0;
const EXIT_THRESHOLD = 1;
const EXIT_ERROR = 2;

const FAIL_LEVELS = ['dead', 'unmaintained', 'stale', 'any'];
const LEVEL_RANK = { healthy: 0, unknown: 0, stale: 1, unmaintained: 2, dead: 3 };

function failLevelToRank(level) {
  if (level === 'any') return 1;
  return LEVEL_RANK[level] ?? null;
}

function readVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function eprint(s) {
  process.stderr.write(s + '\n');
}

/**
 * Ilerleme cizgisi.
 * - TTY: ayni satiri \r ile tazeler, CI loglari temiz kalsin diye TTY disinda
 *   varsayilan olarak hicbir sey yazmaz.
 * - TTY degilken --verbose: satiri bastirma (CI loglarinda kaybolmasin diye),
 *   bunun yerine kisa, kipkisa satirlar yaz; icerik her geciste degistigi
 *   (paketler -> indirme sayilari) icin etiket degisiminde de basar.
 *
 * @param {boolean} verbose TTY disinda da ilerleme yazilsin mi?
 */
function createProgress(verbose = false) {
  const isTTY = Boolean(process.stderr.isTTY);
  let last = '';
  let shown = false;
  let total = 1;
  let plainMark = '';
  const render = (done, totalNow, label) => {
    // Toplam her geciste degisebilir (1. gecis: paketler, 2. gecis:
    // indirme sayilari) — son gelen deger gecerli sayilir.
    if (Number.isFinite(totalNow) && totalNow > 0) total = totalNow;
    const pct = total ? Math.floor((done / total) * 100) : 100;
    const barW = 20;
    const filled = Math.round((pct / 100) * barW);
    const bar = '#'.repeat(filled) + '-'.repeat(barW - filled);
    const line = `  [${bar}] ${String(pct).padStart(3)}%  ${String(done).padStart(4)}/${String(total).padStart(4)}  ${label ?? ''}`;
    if (isTTY) {
      if (line === last) return;
      last = line;
      shown = true;
      process.stderr.write(`\r${line.slice(0, (process.stderr.columns ?? 120) - 1).padEnd((process.stderr.columns ?? 120) - 1)}`);
      return;
    }
    if (!verbose) return;
    // Duz metin: \r anlamsiz. Yuzde 10'luk adimlar ya da etiket degisince yaz.
    const mark = `${Math.floor(pct / 10)}|${(label ?? '').trim()}`;
    if (mark === plainMark) return;
    plainMark = mark;
    process.stderr.write(`  ${line.trimEnd()}\n`);
  };
  const clear = () => {
    if (shown && isTTY) {
      process.stderr.write('\r' + ' '.repeat((process.stderr.columns ?? 120) - 1) + '\r');
      shown = false;
    }
  };
  return { render, clear, isTTY };
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} cikis kodu
 */
export async function main(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        direct: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        compact: { type: 'boolean', default: false },
        html: { type: 'string' },
        'show-healthy': { type: 'boolean', default: false },
        'fail-on': { type: 'string' },
        'min-score': { type: 'string' },
        concurrency: { type: 'string' },
        'cache-ttl': { type: 'string' },
        'no-cache': { type: 'boolean', default: false },
        cwd: { type: 'string' },
        verbose: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    }));
  } catch (err) {
    eprint(red('error: ') + String(err?.message ?? err));
    eprint(dim(' run deaddeps --help for usage'));
    return EXIT_ERROR;
  }

  if (values.help) {
    // Armaya renk colors.js kendi baslar (TERM/CI kosullari); duz metin de ayni hizada.
    process.stdout.write(bannerLines(readVersion()).join('\n') + HELP.replace(/\n$/, '') + '\n');
    return EXIT_OK;
  }
  if (values.version) {
    process.stdout.write(readVersion() + '\n');
    return EXIT_OK;
  }

  const failOn = values['fail-on'];
  if (failOn !== undefined && !FAIL_LEVELS.includes(failOn)) {
    eprint(red(`error: invalid --fail-on value "${failOn}"`) + ` — valid: ${FAIL_LEVELS.join(', ')}`);
    return EXIT_ERROR;
  }

  let minScore = null;
  if (values['min-score'] !== undefined) {
    minScore = Number(values['min-score']);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      eprint(red('error: --min-score must be a number between 0 and 100'));
      return EXIT_ERROR;
    }
  }

  const root = path.resolve(values.cwd ?? positionals[0] ?? process.cwd());

  if (!fs.existsSync(root)) {
    eprint(red(`error: directory not found: ${root}`));
    return EXIT_ERROR;
  }

  const cacheTtlDays = values['cache-ttl'] !== undefined ? Number(values['cache-ttl']) : 7;
  if (!Number.isFinite(cacheTtlDays) || cacheTtlDays < 0) {
    eprint(red('error: --cache-ttl must be 0 or a positive number of days'));
    return EXIT_ERROR;
  }

  const progress = createProgress(Boolean(values.verbose));
  let lastLabel = '';

  const onProgress = (done, total, label) => {
    if (values.json || values.compact) return;
    if (values.verbose || progress.isTTY) {
      progress.render(done, total, label ?? lastLabel);
    }
  };

  let result;
  try {
    result = await scan({
      root,
      directOnly: values.direct,
      concurrency: values['concurrency'] ? Number(values.concurrency) : undefined,
      cache: !values['no-cache'] && cacheTtlDays > 0,
      cacheTtlMs: cacheTtlDays * 24 * 3600 * 1000,
      onProgress,
    });
  } catch (err) {
    progress.clear();
    eprint(red('error: ') + String(err?.stack ?? err?.message ?? err));
    return EXIT_ERROR;
  }
  progress.clear();

  const { rows, meta } = result;

  if (meta.message) {
    eprint(yellow(meta.message));
    eprint(dim(`searched: ${root}`));
    return EXIT_ERROR;
  }

  const version = readVersion();

  // --- HTML raporu (GUI): istege bagli ve metin ciktisindan bagimsiz. ---
  // Basariyla yazildiysa stderr'e bilgi notu duser; stdout pipe'lar temiz kalir.
  if (values.html) {
    const outPath = path.resolve(values.html);
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, renderHtml({ rows, meta, version }), 'utf8');
      eprint(`  ${green('\u2713')} html report: ${dim(outPath)}`);
    } catch (err) {
      eprint(red('error: ') + `cannot write HTML report: ${String(err?.message ?? err)}`);
      return EXIT_ERROR;
    }
  }

  if (values.json) {
    process.stdout.write(renderJson(rows, { ...meta, version }) + '\n');
  } else if (values.compact) {
    process.stdout.write(renderCompact(rows) + '\n');
  } else {
    // TTY'de (ve genislik yeterliyse) basliga logo armasi gelir; borulara
    // ve CI loglarina hic girmek zorunda degil.
    const withBanner = process.stdout.isTTY && (process.stdout.columns ?? 100) >= 72;
    process.stdout.write(
      renderText({
        rows,
        meta,
        showHealthy: values['show-healthy'],
        width: process.stdout.columns ?? 100,
        banner: withBanner ? bannerLines(version) : undefined,
      })
    );
  }

  // --- esik kontrolu ---
  const failed = [];
  if (failOn) {
    const rank = failLevelToRank(failOn);
    for (const row of rows) {
      if ((LEVEL_RANK[row.status] ?? 0) >= rank && (LEVEL_RANK[row.status] ?? 0) > 0) {
        failed.push(row);
      }
    }
  }
  if (minScore !== null) {
    for (const row of rows) {
      if (row.score !== null && row.score !== undefined && row.score < minScore) {
        if (!failed.includes(row)) failed.push(row);
      }
    }
  }

  if (failed.length > 0) {
    if (!values.json && !values.compact) {
      eprint('');
      eprint(
        red(bold(`Threshold crossed: ${failed.length} package(s).`)) +
          ` ${dim(`(fail-on=${failOn ?? 'min-score'}${minScore !== null ? `, min-score=${minScore}` : ''})`)}`
      );
    }
    return EXIT_THRESHOLD;
  }

  return EXIT_OK;
}

export { HELP };
