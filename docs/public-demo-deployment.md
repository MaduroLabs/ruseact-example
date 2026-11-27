# Public Demo Deployment Preparation

This document prepares the consumer repository for a separately authorized
static deployment. It does not create a hosting project, add credentials, or
deploy the site.

## Recommended hosting settings

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Repository root |
| Install command | `corepack pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Output directory | `dist` |
| Node | `24.22.3` from `.nvmrc` |
| pnpm | `12.16.1` through Corepack |
| Deployment mode | Static multi-page output |

The default `pnpm build` is the public build. It does not use `dist-test` and
does not expose browser test-control globals or the benchmark mount marker.
`pnpm build:test` is reserved for local and CI verification and must never be
selected as the hosting build command.

## Build and route verification

The build emits:

- `dist/index.html`
- `dist/hello.html`
- `dist/counter.html`
- `dist/conditional.html`
- `dist/todo.html`
- `dist/reorderable.html`
- shared JavaScript, CSS, and the packaged WASM asset under `dist/assets/`

This is a multi-page application. Do not add SPA rewrites that turn every
unknown path into `index.html`; configure the host to serve the emitted HTML
files directly. Vite emits root-relative asset references for the default `/`
base path. A non-root deployment would require a separately verified Vite
`base` configuration and route test.

## WASM and package requirements

The browser loads WASM from the vendored `ruseact` package through the installed
dependency graph. The host must serve `.wasm` with the WebAssembly-compatible
MIME type `application/wasm` and retain all files under `dist/assets/`. No CDN,
backend, API key, or server-side runtime is required at request time.

The three private alpha.1 tarballs and their provenance/license sidecars remain
part of the repository install path. Run `pnpm artifacts:verify` before the
build. Do not replace them or install from npm.

## Instrumentation separation

The source contains test and benchmark controls only behind the compile-time
`__RUSEACT_INSTRUMENTED__` flag, controlled by the `RUSEACT_INSTRUMENTED=1`
build environment variable. Public `pnpm build` defines that flag as false;
`pnpm build:test` defines it as true and writes `dist-test/`. The public smoke
test inspects emitted JavaScript for these tokens:

- `__ruseactCounterTest`
- `__ruseactConditionalTest`
- `__ruseactTodoTest`
- `__ruseactReorderableTest`
- `__ruseactAuditMount`

It also visits every page with `?test=1&benchmark=1` and asserts that the
globals remain unavailable. URL parameters therefore cannot enable the test
interfaces in the public build.

## Pre-deployment checklist

```sh
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm artifacts:verify
corepack pnpm runtime:smoke
corepack pnpm compile
corepack pnpm typecheck
corepack pnpm build
corepack pnpm smoke:public
corepack pnpm build:test
corepack pnpm test
```

Confirm that all six HTML routes load directly, WASM requests succeed with the
expected MIME type, the public bundle contains no test-control tokens, no
console or asset errors occur, and the hosting build uses `dist`, never
`dist-test`.

## Post-deployment smoke test

After a separately authorized deployment, manually visit the root and each
HTML route in a fresh browser session. Repeat the public smoke flow: open each
page with and without `?test=1&benchmark=1`, exercise Counter, Conditional,
Todo, and Reorderable controls, and inspect the browser console and network
panel. Record the actual deployed URL and browser version in a follow-up
change; no deployment URL is claimed here.

## Known limitations

- Ruseact remains an experimental alpha and is not described as
  production-ready.
- The static review covers Chromium only; Firefox, WebKit, and Safari require
  separate verification.
- The package set is private and vendored rather than registry-published.
- The manual one-pass flush contract and narrow TSX subset remain intentional.
- No analytics, tracking, backend, persistence, or automatic deployment is
  configured.

## Rollback procedure

If a deployed build fails the smoke test, roll back to the previous reviewed
consumer commit. Do not patch deployed assets or replace vendored framework
tarballs in place. Reproduce locally with the exact consumer commit, inspect
`pnpm artifacts:verify`, and publish a reviewed fix through the normal
feature-branch pull request workflow before reauthorizing deployment.
