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

## M4.5.3.1 Conditional Playground

- Expected: independently installed packages should support nested conditional
  regions even when separate compiler plans reuse the local region ID `r0`.
  Actual: the alpha.0 package set failed during nested activation because the
  renderer treated template-local IDs as one global structural namespace.
  Workaround: none was added in the consumer; the framework fixed the identity
  model by scoping structural registration to the owning region and published
  the fix in alpha.1. Impact: this was a framework blocker and prevented the
  original example from running until the matching artifacts were refreshed.
  Future improvement: keep installed-package nested-ownership coverage in the
  consumer regression suite.

- Expected: a conditional marker should read like a normal JSX conditional.
  Actual: the supported form requires an explicit selector dependency, a
  boolean evaluator, and lazy true/false factories. Workaround: the
  Conditional Playground keeps those callbacks small and source-local.
  Impact: it is teachable but narrower than ordinary React-style JSX.
  Future improvement: improve authoring diagnostics without adding implicit
  dependency tracking.

- Expected: opening a panel should preserve all nearby DOM and component state.
  Actual: the persistent input outside the region retains its native node and
  uncontrolled value, while the branch-local input is intentionally recreated
  after branch disposal. Workaround: document the two lifetimes explicitly.
  Impact: no consumer blocker; automatic branch-local state restoration is not
  part of the contract.
  Future improvement: evaluate state-preservation APIs only through a separate
  approved framework decision.

- Expected: lifecycle metrics can directly report every internal cleanup.
  Actual: the public consumer boundary exposes setup counts and observable DOM
  and listener behavior, but not a general component cleanup callback or owner
  registry. Workaround: label the example's metrics as observable behavior and
  avoid fabricated disposal counts. Impact: internal cleanup remains verified
  by framework and installed-package tests rather than an invented API.
  Future improvement: consider a narrowly scoped diagnostic contract only if
  lifecycle observability becomes an approved framework capability.

- Expected: a source edit should preserve application state during development.
  Actual: the consumer-local watcher recompiles supported TSX and relies on a
  full-page reload; it does not provide framework HMR. Workaround: reload after
  setup changes. Impact: acceptable for this playground; state-preserving HMR
  remains out of scope.

- Expected: the package version and artifact source should be obvious during
  review. Actual: the consumer now pins alpha.1 tarballs, the promoted main
  commit, PR provenance, independent checksums, and package license notices.
  Workaround: run `pnpm artifacts:verify` before every build. Impact: the
  matching-set procedure is explicit but more involved than registry install.

## M4.5.3.2 Todo Application

- Expected: a collection can be rendered with ordinary JSX array operations.
  Actual: the supported keyed subset requires `ruseact.keyed([revision],
  collectionEvaluator, itemFactory)`, one explicit scalar revision dependency,
  scalar item fields, and a lazy item factory. Workaround: keep the authoritative
  `TodoRecord[]` in JavaScript and publish a revision after each collection
  change. Impact: this is a consumer authoring constraint, but it does not block
  the Todo example. Future improvement: provide clearer editor and compiler
  diagnostics for the provisional marker.

- Expected: retained task data can be updated through mutable component props.
  Actual: component props are immutable; the renderer-owned `fields` handles
  are passed as explicit signal props to `TodoItem`. Retained title and checked
  bindings update without rerunning item setup. Workaround: include every
  supported scalar item field in the stable descriptor schema. Impact: no blocker
  for scalar task data; array/object fields remain unsupported.

- Expected: one flush drains every consequence of a collection update.
  Actual: keyed reconciliation can write retained item field signals after the
  current pending snapshot has been taken. Toggle and save therefore perform a
  second explicit flush at the event boundary. Workaround: document the exact
  operations that use the bounded second call. Impact: no hidden scheduler is
  introduced, but application authors must understand one-pass semantics.

- Expected: filtering only changes visibility while preserving every item.
  Actual: filtered-out items leave the keyed region and their renderer-owned
  resources are disposed; returning items receive fresh activation identities.
  Workaround: use stable task IDs and treat filtered-out uncontrolled state as
  intentionally discarded. Impact: expected structural behavior, not a blocker.

- Expected: item event closures can safely capture a task object from initial
  setup. Actual: retained item data changes without component rerendering, so
  the Todo item reads its stable renderer-owned task-key signal at event time.
  Workaround: never capture mutable array positions or stale records in item
  listeners. Impact: no blocker, but this is an important keyed-list discipline.

- Expected: nested edit regions expose general component lifecycle callbacks.
  Actual: the public consumer boundary exposes setup counts and observable DOM
  and listener behavior, not an internal owner registry or cleanup hook.
  Workaround: verify nested conditional removal through detached-node listener
  behavior and application disposal. Impact: internal cleanup remains an
  implementation contract rather than a fabricated application metric.

- Expected: the Todo application can persist data between page visits.
  Actual: the example keeps data in memory only. Workaround: none in this
  milestone. Impact: persistence, backend integration, and localStorage are
  deferred to later consumer work.
