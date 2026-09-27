# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
