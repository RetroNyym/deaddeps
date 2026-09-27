# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.1.1 - 2026-09-27

### Changed

- **Releases now publish through npm trusted publishing (OIDC).** The GitHub
  Actions workflow authenticates with a short-lived identity token instead of
  a long-lived npm token, so publishing keeps working after npm retires
  2FA-bypass tokens in January 2027. The job pins Node 24 (npm ≥ 11.5.1, the
  minimum release that speaks OIDC) and fails early if the runner's npm is
  older — npm 10 and below silently skip the OIDC exchange.
- The publish job no longer passes `registry-url` to `actions/setup-node`: it
  wrote an empty `_authToken=${NODE_AUTH_TOKEN}` line that made npm treat auth
  as configured and skip OIDC altogether (npm/documentation#1960).
- No CLI behaviour changed in this release; it exists to exercise the new
  publish path end to end.

## 1.1.0 - 2026-09-27

### Added

- **Logo** (`docs/logo.svg`): a gravestone with two dependency boxes and the
  broken link between them — the same mark in three places: README,
  `deaddeps --help` and the HTML report.
- **ASCII banner** on top of `--help` and on top of the report when stdout is a
  TTY. Piped and CI output is unchanged, so logs stay clean.
- **`--html <file>`**: a self-contained visual report — inline SVG logo, inline
  styles, status filters, package search, score meters, blast-radius callout,
  light and dark theme. No external requests: the file opens offline, works as
  an email attachment and as a PR artifact. Exit codes and `--fail-on` are
  unaffected.
- `test/logo.test.js` and `test/html.test.js`: banner alignment, logo file ↔
  source sync, HTML escaping, "no external resources" and an end-to-end
  `--html` run.

### Fixed

- `npm test` runs on Windows again: `node --test test/*.test.js` relied on a
  shell glob that `pwsh` does not expand, so Node 18/20 failed with
  `Could not find ...\test\*.test.js` while Ubuntu passed. The script is now
  `node --test`, which discovers `test/` itself on every platform and version.
- The HTML report no longer prints the npm deprecation message twice (reasons
  list and deprecation box).

## 1.0.0 - 2026-09-27

First release.

### Added

- Status ladder — `DEAD` / `UNMAINTAINED` / `STALE` / `HEALTHY` / `UNKNOWN` —
  with exact, documented thresholds (>4y, >2y, >1y) in `src/score.js`.
- Transparent 0–100 score: publish age, maintainer count (bus factor),
  repository link, unknown data. Every penalty is one readable line.
- Registries: **npm** (`registry.npmjs.org` + deps.dev publish timestamps),
  **PyPI** (`pypi.org` + `pypistats.org`), **crates.io**.
- Manifests and lockfiles: `package.json`, `package-lock.json` (v1/v2/v3),
  `npm-shrinkwrap.json`, `yarn.lock` (v1 + berry), `pnpm-lock.yaml`,
  `requirements*.txt`, `pyproject.toml` (PEP 621 + Poetry), `Cargo.toml`,
  `Cargo.lock`.
- Two-pass scan: package metadata first, download counts second (npm counts
  fetched **in bulk**, 90 packages per request).
- Blast radius line: monthly downloads still flowing through flagged packages.
- `--fail-on` / `--min-score` CI gates with exit codes 0 / 1 / 2, `--json`,
  `--compact`, `--direct`, `--show-healthy`, `--verbose`, `--no-cache`.
- Disk cache (7 days) so a second run is nearly instant.
- 54 hermetic tests on `node --test`, no framework, no devDependencies.

### Notes

- Status is judged on the **latest** release date; the installed version only
  drives the `deprecated` / `yanked` flag.
- `dependents` is deliberately `null` — npm's search index rate-limits too
  hard to report it honestly.
