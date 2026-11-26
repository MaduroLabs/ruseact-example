# M4.5.2 developer-experience observations

This document records observations from the independent Hello World and Counter bootstrap. It is intentionally an input to M4.5.3/M5 planning, not a promise to change framework semantics in this repository.

## Package installation

- Expected: a consumer can install a matching Ruseact package set from a registry.
- Actual: the packages are private and unpublished, so this repository vendors the reviewed tarballs and uses a local `pnpm` override for the exact `ruseact-dom` runtime dependency.
- Workaround: run `pnpm artifacts:verify` before installation and keep the three tarballs plus manifest together.
- Impact: does not block this bootstrap, but artifact acquisition is more involved than a normal registry install.

## Artifact distribution

- Expected: CI artifacts would be a durable dependency source.
- Actual: workflow artifacts expire, so durable reviewed tarballs are kept in this repository.
- Workaround: rebuild from the pinned framework source commit only as an explicit artifact replacement and update checksums/provenance together.
- Impact: repository size and review cost increase slightly; this avoids a hidden dependency on an expiring URL.

## TypeScript authoring

- Expected: TSX source has a framework-provided JSX type contract.
- Actual: the compiler supports a narrow TSX subset and the current packages do not provide a permanent JSX namespace for consumer source.
- Workaround: the consumer provides a small local declaration for supported intrinsic elements and `ruseact.bindText`.
- Impact: unsupported JSX is still rejected by the compiler, but editor-level authoring feedback is intentionally provisional.

## JSX/TSX compiler syntax

- Expected: ordinary React-style JSX expressions are accepted.
- Actual: reactive content must use explicit compiler markers and the generated module exports a `createView` function.
- Workaround: keep examples to static nodes, explicit `ruseact.bindText`, and native event handlers.
- Impact: this is a teaching constraint, not a blocker for the supported examples.

## Development workflow

- Expected: `pnpm dev` watches TSX and reloads the browser.
- Actual: the consumer-local dev wrapper reruns the precompiler on edits and lets Vite reload generated modules; it does not preserve component state across source edits.
- Workaround: use a full page reload when changing setup code.
- Impact: adequate for bootstrap examples; framework HMR remains out of scope.

## WASM initialization

- Expected: importing the runtime is enough to create a core.
- Actual: the application must explicitly initialize the packaged web WASM module and pass it to `createReactiveCore`.
- Workaround: `src/bootstrap/mount.ts` owns that sequence and reports structured failures.
- Impact: one extra visible bootstrap step, with a clear ownership boundary.

## Reactive update ergonomics

- Expected: a signal write immediately changes the DOM.
- Actual: a signal write only invalidates the relevant computation; the application must call `root.flush()`.
- Workaround: the Counter event handlers write the signal and call `flush()` explicitly.
- Impact: intentional and observable; automatic scheduling is not part of this milestone.

## Error handling

- Expected: framework errors appear as ordinary exceptions.
- Actual: runtime and renderer operations return structured results.
- Workaround: the consumer bootstrap normalizes failed result codes for the example UI and console while preserving the explicit operation boundary.
- Impact: a little application glue is required, but failures are not hidden.

## Cleanup

- Expected: page teardown is implicit.
- Actual: the application disposes the root before its runtime and explicitly disposes the Counter's application-owned signal.
- Workaround: `mountApplication` owns the ordered cleanup boundary.
- Impact: this keeps ownership visible and avoids inventing a global runtime.

## Browser asset loading

- Expected: package-local WASM loads without framework source paths.
- Actual: the packaged `ruseact/wasm/web` loader resolves its sibling binary through Vite's installed-package graph.
- Workaround: package verification and production browser tests exercise the relocated package assets.
- Impact: no external CDN or Rust toolchain is required for the consumer.
