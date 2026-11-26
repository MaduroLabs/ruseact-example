# Ruseact Example

This repository is the independent consumer bootstrap for [Ruseact](https://github.com/MaduroLabs/ruseact). It demonstrates the experimental framework through three small applications:

- `/hello.html` — static Hello World mounting.
- `/counter.html` — an explicit scalar signal, native event handlers, and manual `root.flush()`.
- `/conditional.html` — nested conditional regions, one-shot component setup, and branch-local DOM lifetimes.

The repository is public. The package artifacts remain private and are not published to npm.

## Pinned distribution

The examples consume the authoritative promoted Ruseact `0.1.0-alpha.1` artifact set built from framework `main` commit `2a0ab7781b6c56fde643bf6bc8ed3f550097209c`. The distribution refresh was reviewed in framework PR #67 and promoted by PR #68. It includes the owner-scoped structural identity fix from PRs #62/#66 and the benchmark calibration hardening from PRs #64/#65.

The artifact set supports renderer template protocols 1–4 and contains:

| Package | Tarball bytes | SHA-256 |
| --- | ---: | --- |
| `ruseact` | 78,819 | `2101d2a8c038fbefbfcb091b5a337462dbbb67a8b1d253398679eca551663867` |
| `ruseact-dom` | 76,434 | `7323748f727057476d6282c7e40ff01537767e1108f903554a88a3b0c078c8e3` |
| `ruseact-compiler` | 22,832 | `bb180975b41099cea8ce428126b04aec28dc9d08bb569f4805b705f374ef06d1` |

`artifacts/ruseact/0.1.0-alpha.1/distribution-manifest.json` records the framework-generated measurements; `consumer-provenance.json` records the reviewed distribution and promotion relationship. `pnpm artifacts:verify` independently checks both files, package metadata, sizes, checksums, source provenance, runtime dependency, protocols, and license contents.

The vendored artifact set is accompanied by `LICENSE` and `NOTICE.md`. Each alpha.1 tarball also contains the framework MIT license at `package/LICENSE`, and the exact license and attribution notices are verified as part of the complete vendored set.

The previous alpha.0 artifact record remains available in Git history. Its source and checksums were `1cd9a19200d3faea2d3f84f5a162a2e7b8e3c3d5` / `ef4ffdc46e4f3be98c270db7ac1a428573780afe`, with tarball checksums recorded by the original bootstrap commit; it is not an active dependency of this checkout.

## Requirements

- Node.js `24.22.3` (see `.nvmrc`).
- pnpm `12.16.1` through Corepack.
- A browser for development. The automated test uses Chromium.

Vite is pinned to `8.3.8`, the latest verified stable version at bootstrap time with an engine range compatible with Node 24.22.3. No React, React DOM, JSX runtime, or other frontend framework is installed.

## Install and run

From a fresh checkout:

```sh
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm artifacts:verify
corepack pnpm dev
```

Open:

- `http://127.0.0.1:5173/` — example index.
- `http://127.0.0.1:5173/hello.html` — Hello World.
- `http://127.0.0.1:5173/counter.html` — Counter.
- `http://127.0.0.1:5173/conditional.html` — Conditional Playground.

The `dev` wrapper verifies the artifacts, compiles supported TSX into ignored `.generated/` modules, starts Vite, and reruns the consumer-local precompiler when example TSX changes. It is not an official Ruseact Vite plugin and does not provide framework HMR.

## Build and test

```sh
corepack pnpm artifacts:verify
corepack pnpm compile
corepack pnpm typecheck
corepack pnpm build
corepack pnpm preview
```

`pnpm build` verifies artifacts, precompiles TSX, typechecks the consumer, and produces a Vite production build in ignored `dist/`. `pnpm preview` serves that build at `http://127.0.0.1:4173/`.

Run the real-WASM Chromium acceptance test with:

```sh
corepack pnpm test
```

The test covers Hello World, Counter interactions, explicit no-update-before-flush behavior, stable output-node identity, keyboard activation, persisted pagehide handling, explicit disposal, listener cleanup, application-owned signal disposal, repeated disposal, Conditional Playground nested branches, branch-local and persistent input identity, production WASM loading, and missing-error checks. It uses the local Chromium executable or `CHROMIUM=/path/to/chromium`.

## How the bootstrap works

TSX is compiled at build time by the installed `ruseact-compiler` package. The compiler emits executable ESM modules with ViewDescription protocol metadata; the browser never receives the TypeScript compiler or raw TSX.

The application explicitly initializes the packaged WASM loader:

```ts
import initializeWasm, * as wasm from "ruseact/wasm/web";
import { createReactiveCore } from "ruseact";

await initializeWasm();
const result = await createReactiveCore(() => wasm);
```

The actual bootstrap checks the structured result, creates a root with `createRoot(container, runtime)`, mounts the generated view, and disposes the renderer root before disposing the application-owned runtime. The Counter creates one application-owned signal and disposes it explicitly during application cleanup.

Counter event handlers update the signal and then call `root.flush()`. A write without a flush does not update the DOM; this is deliberate one-pass manual flush behavior.

## Project layout

```text
src/bootstrap/mount.ts       Application-owned WASM/root lifecycle
src/examples/*/App.tsx       Supported consumer TSX source
scripts/precompile.mjs       Consumer-local build-time compiler call
scripts/verify-artifacts.mjs Tarball/provenance/checksum validation
scripts/dev.mjs              Vite plus bounded TSX recompilation wrapper
scripts/test.mjs             Real Chromium production verification
artifacts/ruseact/...        Reviewed package tarballs and provenance
```

## Limitations and handoff

This is an experimental package and consumer environment, not a production-ready distribution and not a full React compatibility layer. Packages are private and must remain a matching set. The current consumer-local JSX declaration is provisional, compiler support is intentionally narrow, and the dev wrapper uses full-page reload semantics rather than HMR. No automatic dependency tracking, automatic scheduling, runtime TSX compilation, deployment, npm publication, or application collection is included.

M4.5.3.1 now demonstrates the supported conditional marker, lazy branch initialization, nested component ownership, stable parent setup, explicit flushing, and persistent versus branch-local DOM state. The framework-level duplicate-local-ID blocker was resolved in the promoted alpha.1 distribution. M4.5.3.2 can build the Todo Application on this foundation; it should reuse the verified artifact procedure, generated-module boundary, explicit WASM bootstrap, manual flush contract, and browser harness without silently introducing new framework semantics.
