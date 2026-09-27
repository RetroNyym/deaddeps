# Contributing

Thanks for looking at deaddeps.

## Run it

No install step, no build step:

```bash
npm test              # node --test, no framework, no devDependencies
npm start -- .        # scan the current directory
node bin/deaddeps.js <directory> --json
```

Node **18.17+** is required. The project is plain ESM.

## Ground rules

1. **Zero dependencies stays zero.** No `chalk`, no `yargs`, no test framework,
   no bundler, no devDependencies. If a feature seems to need a dependency,
   open an issue and we will write the 40 lines instead.
2. **No API keys, no accounts.** Only public endpoints may be added, and each
   one must degrade gracefully: a missing field is `null`, never a guess.
3. **Thresholds live in exactly one place.** Status cut-offs and score
   penalties are in `src/score.js` and must stay identical to the tables in
   the README and the assertions in `test/score.test.js`. Changing one without
   the others fails review.
4. **User-facing text is English.** Comments in the source may be any language
   you are comfortable in.
5. **Tests run without network.** `test/*.test.js` must stay hermetic; live
   registries are exercised manually against the sample projects.

## Pull requests

- One behaviour per PR, with a test that fails before your change.
- If the CLI output changes, update the example block and `docs/demo.svg` in
  the same PR so the README never lies.
- `npm test` must pass on Linux and Windows (CI runs both).

## Releases

Tag is created locally, pushed, then a GitHub Release triggers
`.github/workflows/publish.yml`, which publishes through npm trusted
publishing (OIDC) — no token in the repository.
