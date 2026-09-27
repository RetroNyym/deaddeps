# Security Policy

## Reporting a vulnerability

Please use a private report instead of a public issue:

https://github.com/RetroNyym/deaddeps/security/advisories/new

Include what you ran, what you expected and what happened. I usually answer
within a few days.

## What this tool does with your data

- **Zero runtime dependencies.** The tool itself has no supply chain: `npm ls`
  in this repository is empty, and it stays that way.
- **No credentials.** deaddeps never asks for an API key, a token or an npm
  login. It talks to public endpoints only: `registry.npmjs.org`,
  `api.deps.dev`, `api.npmjs.org`, `pypi.org`, `pypistats.org`, `crates.io`.
- **No telemetry.** Nothing is sent anywhere except those registries, and only
  when you run a scan.
- **On-disk cache.** Registry responses are cached for 7 days under
  `~/.cache/deaddeps` (Linux/macOS) or `%LOCALAPPDATA%\deaddeps` (Windows).
  It contains package metadata, never credentials. Delete the directory to
  remove it; `--no-cache` skips it entirely.
- **Only reads your project.** Manifests and lockfiles are parsed locally and
  never uploaded.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | yes |

Older versions are not patched; upgrade with `npx deaddeps@latest`.
