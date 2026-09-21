# Vendored anti-slop plugin

Installed 2026-09-21 from the `install-anti-slop` skill bundle (`assets/anti-slop`). The installer only copies files; this tree is the bundle copy, unmodified.

## Source identity

- Upstream repository and commit: **unknown** — the bundle ships no VCS identity. Establish it from the bundle actually being ported before claiming a revision; do not guess.
- Recoverable pristine snapshot: the skill bundle directory, byte-identical to this installation (`diff -r` reported no differences at install time).
- Bundle tree digest (SHA-256 of the tarred directory): `8c515b339139186624c203b528df266856670f4ece78ca6dceddd9ddcde8f9e7`.
- The nested `vendor/eslint-stylistic/UPSTREAM.md` carries exact provenance — repository, commit `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`, copied files, and adaptations — for the vendored `padding-line-between-statements` rule.

## Installed paths

- Generic plugin entry point: `tools/oxlint/anti-slop/index.ts`, registered as `anti-slop`.
- `rules/` — 18 generic rules; `shared/` — rule helpers; `vendor/eslint-stylistic/` — vendored rule source plus `LICENSE` and its own `UPSTREAM.md`.
- Opt-in Effect plugin (`effect/index.ts`) is present but **not registered**: this repository has no direct `effect` dependency. If it is ever enabled, note that its service-constructor rule resolves relative project imports only, not package aliases.

## Configuration

- `vite.config.ts`: `lint.jsPlugins` → `./tools/oxlint/anti-slop/index.ts`; all 18 generic rules plus the native companion `oxc/no-accumulating-spread` run at `"error"`.
- `tools/oxlint/anti-slop/**` is in both `lint.ignorePatterns` and `fmt.ignorePatterns`: vendored code is never linted or reformatted as application source.
- Dependency: `@oxlint/plugins` pinned exactly to `1.81.0` (devDependency), matching the oxlint that Vite+ 0.3.1 executes (`pnpm-lock.yaml`). Move both together with the Vite+ oxlint upgrade; never bump one alone.

## Local deviations

None in the vendored source. Local additions are limited to this record and the lint/format configuration above.

## Verification at install

- `pnpm run lint` (`vp check`): format pass (272 files); lint reports 1475 findings in application source — 948 `require-readable-spacing`, 341 `require-safety-comment-for-type-assertion`, 67 `no-runtime-typeof`, 33 `no-unknown-parameters`, 32 `no-known-value-widening`, 29 `no-unsafe-dictionary-type`, 20 `no-chained-type-assertions`, 4 `no-unknown-returns`, 1 `no-conditional-empty-object-spread`. Reported, not fixed: application cleanup is a separate authorized change.
- `pnpm run check` (svelte-check `--tsgo`): 0 errors, 0 warnings.
- `pnpm run knip`: pass.

## Updating

Use the `install-anti-slop` update procedure. Never run the installer with `--force` over this tree. No upstream base exists beyond the exact bundle copy recorded above — future updates must reconcile the new bundle (or an identified upstream revision) against these files and re-record identity, deviations, and verification here.
