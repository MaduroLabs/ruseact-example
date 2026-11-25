# Ruseact Example

This repository is the independent consumer bootstrap for [Ruseact](https://github.com/MaduroLabs/ruseact). It demonstrates the experimental framework through two small applications:

- `/hello.html` — static Hello World mounting.
- `/counter.html` — an explicit scalar signal, native event handlers, and manual `root.flush()`.

The repository is currently private. No visibility change was made as part of this bootstrap, and the package artifacts are not published to npm.

## Pinned distribution

The examples consume the reviewed Ruseact `0.1.0-alpha.0` artifact set from framework source commit `1cd9a19200d3faea2d3f84f5a162a2e7b8e3c3d5`, whose tree is represented by promoted framework `main` commit `ef4ffdc46e4f3be98c270db7ac1a428573780afe`.

The artifact set supports renderer template protocols 1–4 and contains:

| Package | Tarball bytes | SHA-256 |
| --- | ---: | --- |
| `ruseact` | 78,248 | `baa47209ece2a943f3990eff4a0e4ca527c84a88c3fd0124cae0d0b73b3bb0c2` |
| `ruseact-dom` | 74,898 | `ab799f42890ddd5dcd313af27fd71a25caf9be8d96da1889f86601cac8073296` |
| `ruseact-compiler` | 22,072 | `1017c2888fb7e1f69d07de480e182169a21785bc4db56c4b24156f09331f52e1` |

`artifacts/ruseact/0.1.0-alpha.0/distribution-manifest.json` records the framework-generated measurements; `consumer-provenance.json` records the promotion relationship. `pnpm artifacts:verify` checks both files, package metadata, sizes, and checksums.

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

The test covers Hello World, Counter interactions, explicit no-update-before-flush behavior, stable output-node identity, production WASM loading, and missing-error checks. It uses the local Chromium executable or `CHROMIUM=/path/to/chromium`.

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

M4.5.3 can build richer consumer examples on this foundation. It should reuse the verified artifact procedure, generated-module boundary, explicit WASM bootstrap, manual flush contract, and browser harness. It should not silently introduce new framework semantics while adding conditional panels, todo flows, or reorderable examples.
