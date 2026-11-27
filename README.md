# Ruseact Example

This repository is the independent consumer bootstrap and public demonstration surface for [Ruseact](https://github.com/MaduroLabs/ruseact). It demonstrates the experimental framework through five small applications:

- [Hello World](https://ruseact-example.vercel.app/hello.html) (`/hello.html`) — static Hello World mounting.
- [Counter](https://ruseact-example.vercel.app/counter.html) (`/counter.html`) — an explicit scalar signal, native event handlers, and manual `root.flush()`.
- [Conditional Playground](https://ruseact-example.vercel.app/conditional.html) (`/conditional.html`) — nested conditional regions, one-shot component setup, and branch-local DOM lifetimes.
- [Todo Application](https://ruseact-example.vercel.app/todo.html) (`/todo.html`) — a JavaScript-owned Todo collection rendered with keyed items, retained field signals, filtering, and explicit flushes.
- [Reorderable List](https://ruseact-example.vercel.app/reorderable.html) (`/reorderable.html`) — native keyed range movement, uncontrolled input state, browser focus observations, and nested item ownership.

## Live demo

**[Open the Ruseact alpha.1 showcase](https://ruseact-example.vercel.app/)**

The showcase is a static deployment of this public consumer repository. Ruseact
remains experimental and is not presented as production-ready.

The repository is public. The package artifacts remain private and are not published to npm.

Ruseact is experimental and is not presented as production-ready. The default
production build is a static, instrument-free showcase; correctness and
benchmark controls are kept in a separate instrumented build.

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
- `http://127.0.0.1:5173/todo.html` — Todo Application.
- `http://127.0.0.1:5173/reorderable.html` — Reorderable List.

The `dev` wrapper verifies the artifacts, compiles supported TSX into ignored `.generated/` modules, starts Vite, and reruns the consumer-local precompiler when example TSX changes. It is not an official Ruseact Vite plugin and does not provide framework HMR.

## Public and instrumented builds

The public build is the default and emits `dist/`:

```sh
corepack pnpm build
corepack pnpm smoke:public
```

The correctness and benchmark harnesses use a separate instrumented build in
`dist-test/`:

```sh
corepack pnpm build:test
corepack pnpm test
corepack pnpm audit:benchmark
corepack pnpm audit:benchmark:validate
```

Test-control globals and benchmark mount markers are compile-time excluded from
the public build. Query parameters such as `?test=1` and `?benchmark=1` do not
enable those interfaces in `dist/`.

## Todo Application

The Todo Application uses the installed version 4 keyed-list marker:

```tsx
ruseact.keyed(
  [revision],
  ({ runtime: currentRuntime }) => ({
    ok: true,
    value: getVisibleTodos().map((todo) => ({
      key: todo.id,
      fields: { taskKey: todo.id, title: todo.title, completed: todo.completed },
    })),
  }),
  ({ fields }) => <TodoItem taskKey={fields.taskKey} title={fields.title} completed={fields.completed} />,
)
```

Todo records remain in JavaScript. The application publishes a new immutable
collection and increments the explicit revision signal after each collection
operation. The renderer owns the scalar field signals passed to retained
`TodoItem` instances, so title and completion updates do not rerun retained
component setup or replace retained item nodes. Keys are stable task IDs, never
array indexes, and removed IDs are not reused during the application lifetime.

Filtering removes excluded items from the keyed region; an item that becomes
visible again receives a fresh activation. Reversing the collection moves the
existing native ranges. The edit form is an explicit nested conditional region
inside each keyed item, so its input is intentionally branch-local.

Most operations complete with one explicit `root.flush()`. Toggle and save
operations make retained field writes during structural reconciliation visible
with a second explicit `root.flush()`. This is a deliberate bounded use of the
one-snapshot contract, not recursive draining or an automatic scheduler.

## Reorderable List

`/reorderable.html` focuses on native keyed range movement. Its movement
buttons publish a new JavaScript collection order and call the existing
`root.flush()`; application code never calls `appendChild`, `insertBefore`, or
another DOM movement method. The provisional keyed syntax is the same
`ruseact.keyed([revision], collectionEvaluator, itemFactory)` contract used by
the Todo Application.

Each retained item contains a reactive title, an uncontrolled text input, an
uncontrolled checkbox, movement controls, and a nested conditional detail
region. The browser regression confirms that item nodes, input nodes, input
values, and checkbox state survive movement. Removed items receive fresh
activations when restored with new monotonically increasing keys.

Focus and selection are measured rather than restored: Chromium preserved
focus and selection when the focused item itself moved, lost them when another
item moved around it or when an insertion occurred before it, preserved them
when an unrelated item was removed or retained title data changed, and cleared
them when the focused item was removed. These are observations for the tested
Chromium environment, not cross-browser guarantees.

Native drag-event syntax is accepted by the installed compiler, but drag and
drop is intentionally not enabled in this example. The required keyboard and
button controls provide the verified movement path; no unverified browser drag
semantics or manual DOM fallback is introduced.

## Build and test

```sh
corepack pnpm artifacts:verify
corepack pnpm compile
corepack pnpm typecheck
corepack pnpm build
corepack pnpm smoke:public
corepack pnpm preview
```

`pnpm build` verifies artifacts, precompiles TSX, typechecks the consumer, and produces a Vite production build in ignored `dist/`. `pnpm preview` serves that build at `http://127.0.0.1:4173/`.

Run the real-WASM Chromium acceptance test with:

```sh
corepack pnpm test
```

The test covers Hello World, Counter interactions, explicit no-update-before-flush behavior, stable output-node identity, keyboard activation, persisted pagehide handling, explicit disposal, listener cleanup, application-owned signal disposal, repeated disposal, Conditional Playground nested branches, branch-local and persistent input identity, production WASM loading, and missing-error checks. It uses the local Chromium executable or `CHROMIUM=/path/to/chromium`.

The recommended static-hosting settings and pre-deployment checklist are in
[`docs/public-demo-deployment.md`](docs/public-demo-deployment.md). No public
deployment has been performed and no deployment domain is assumed.

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

M4.5.3.1 demonstrates the supported conditional marker, lazy branch initialization, nested component ownership, stable parent setup, explicit flushing, and persistent versus branch-local DOM state. M4.5.3.2 adds the Todo Application using the provisional keyed marker. M4.5.3.3 adds Reorderable List movement and records actual Chromium focus/selection behavior without promising restoration. The framework-level duplicate-local-ID blocker was resolved in the promoted alpha.1 distribution. No automatic scheduler, manual DOM reconciliation, or drag-and-drop fallback is added.

## M4.5.4 validation audit

The consumer validation and developer-experience audit is recorded in:

- [`docs/m4.5.4-consumer-validation.md`](docs/m4.5.4-consumer-validation.md) — correctness, cleanup, diagnostics, browser, accessibility, deployment readiness, and reproduction evidence.
- [`docs/m4.5.4-dx-audit.md`](docs/m4.5.4-dx-audit.md) — authoring measurements, stable DX finding register, and prioritized follow-up.
- [`docs/m4.5.4-benchmark-baseline.md`](docs/m4.5.4-benchmark-baseline.md) — reproducible application-level baseline and retained raw evidence.
- [`docs/m5-scheduling-proposal.md`](docs/m5-scheduling-proposal.md) — proposed scheduler alternatives and human approval questions. No M5 implementation is included.

The audit uses installed alpha.1 packages and real Chromium. Unresolved
sub-millisecond benchmark rows remain explicitly unresolved; they are not
reported as zero-cost results. The reports distinguish verified behavior from
intentional architectural limitations, consumer tooling friction, and browser-
specific observations.

## Frontend design quality policy

The custom Frontend Design Guardian now requires evidence-based review before
accepting a visual direction: separate typography, copywriting, hierarchy,
accessibility, responsive, computed-style, second-order anti-slop, and human
review gates. Impeccable detection is used as an advisory signal; a clean
detector result is not design approval.

The dependency-free computed-style audit and its fixtures can be run with:

~~~sh
node .agents/skills/frontend-design-guardian/scripts/test-audit-design.mjs
node .agents/skills/frontend-design-guardian/scripts/audit-design.mjs \
  --json --viewport=1440x900 path/to/static-page.html
corepack pnpm build:test
node .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs
# Instrumented served application, including its test-only mount marker:
corepack pnpm exec vite preview --outDir dist-test --host 127.0.0.1 --port 4173 --strictPort
node .agents/skills/frontend-design-guardian/scripts/audit-design.mjs \
  --json --viewport=1440x900 \
  --url='http://127.0.0.1:4173/hello.html?benchmark=1&design-audit=1' \
  --ready-text="Hello, world!" \
  --ready-expression='Boolean(window.__ruseactAuditMount)'
# Public served application, without test-only globals:
corepack pnpm build
# Serve dist on port 4173 in another shell, then run:
corepack pnpm exec vite preview --outDir dist --host 127.0.0.1 --port 4173 --strictPort
RUSEACT_AUDIT_DIST=dist RUSEACT_AUDIT_QUERY= \
RUSEACT_AUDIT_READY_TEXT="Hello, world!" \
RUSEACT_AUDIT_READY_EXPRESSION='Boolean(document.querySelector("#app")?.textContent?.includes("Hello, world!"))' \
node .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs
~~~

The policy, research evidence, and review of the three unapproved temporary
design prototypes are recorded in
[docs/anti-slop-quality-review.md](docs/anti-slop-quality-review.md).
This policy task does not change production UI, approve Tracebench, Field
Guide, or Signal Atlas, or begin M5.
