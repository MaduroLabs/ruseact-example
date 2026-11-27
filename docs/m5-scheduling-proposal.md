# Proposed M5 Scheduling Architecture

> This is a consumer-repository research proposal. Every decision in this
> document is **PROPOSED**, not accepted. No scheduler is implemented by M4.5.4.

## Problem statement

Alpha.1 is correct and measurable with explicit application-controlled flushes,
but the five examples expose recurring execution ceremony. A collection update
can require a structural flush followed by a bounded scalar flush when retained
item fields are written during reconciliation. Developers must know the pending
snapshot contract, call the correct root, and avoid recursive draining.

M5 should improve execution ergonomics only after preserving the identity,
ownership, ordering, cleanup, and error invariants demonstrated by the consumer.

## Current alpha.1 execution model

The installed runtime performs equality-aware scalar writes and delegates dirty
propagation to Rust. The DOM binding context drains a shared pending set into a
FIFO snapshot, resolves exact computation handles, and dispatches scalar or
structural records once. Structural updates can create new work after the
snapshot has been taken; that work remains for a subsequent explicit flush.

The binding context rejects reentrant flushes, rejects unknown pending
computations, and tracks exact computations disposed during the active snapshot
so they are skipped without confusing them with a later handle. Root disposal
cleans bindings and host resources before marking the root disposed. Runtime
disposal invalidates its signal and computation handles.

Source evidence at promoted alpha.1:

- `packages/ruseact-dom/src/bindings.ts:602-672` — snapshot drain, FIFO
  dispatch, same-snapshot disposal, and report accounting.
- `packages/ruseact-dom/src/bindings.ts:277-285` — active context, flush guard,
  snapshot state.
- `packages/ruseact-dom/src/root.ts:421-474` — root flush/disposal boundary.
- `packages/ruseact/src/runtime.ts:129-162` — scalar set/equality bridge and
  signal disposal.
- `packages/ruseact/src/runtime.ts:322-370` — pending computation identity and
  runtime disposal.

This is a RustReactiveCore execution model, not React Fiber.

## Evidence from the consumer

- Counter scalar updates are naturally one-flush operations.
- Conditional branch replacement and pure keyed movement are one-flush paths
  in the tested applications.
- Todo toggle/save and retained-title updates require two explicit flushes in
  the current application contract because retained field writes are generated
  during structural processing.
- Reentrant execution is intentionally rejected.
- The browser suite passes without automatic scheduling, and benchmark evidence
  shows sub-millisecond local operation medians with quantized unresolved no-op
  rows. These numbers are a baseline, not an argument for a specific scheduler.

## Design goals and non-goals

Goals:

1. Make a documented completion boundary easier to express.
2. Preserve exact computation identity and FIFO snapshot ordering.
3. Preserve root isolation, ownership, cleanup, and structured errors.
4. Bound work and make generated work observable.
5. Keep manual execution available for tests and deterministic applications.
6. Avoid requiring a Rust/WASM ABI change unless evidence proves it necessary.

Non-goals:

- implicit dependency tracking;
- recursive flush-until-empty behavior;
- React compatibility, hooks, or virtual DOM;
- replacing scalar signals with object/array signals;
- a global scheduler shared by unrelated runtimes;
- silent changes to DOM timing or error propagation.

## Alternatives

| Option | Strength | Main risk | Complexity |
| --- | --- | --- | --- |
| A. Manual-only | Deterministic and compatible; current behavior | Highest authoring ceremony | Low |
| B. Opt-in microtask | Natural event-boundary ergonomics; coalesces writes | Starvation, error timing, hidden work, cleanup races | Medium/High |
| C. Animation frame | Aligns selected visual work with browser frames | Wrong latency for nonvisual work; frame throttling | High |
| D. Explicit transaction/event boundary | Clear completion semantics and batching | More API surface and transaction failure rules | Medium/High |
| E. Hybrid | Can use manual, microtask, and frame modes by workload | Largest semantic surface and testing burden | High |

Microtasks are not automatically more responsive: a long or self-invalidating
queue can delay the browser. Animation frames are not suitable for every signal
update. A transaction boundary may be the clearest way to preserve explicit
completion, but it needs a carefully specified error and disposal model.

## Proposed direction

**PROPOSED:** begin with a root-local opt-in execution coordinator, retaining
manual-only behavior as the default. The coordinator would schedule at most one
bounded execution opportunity after an explicit opt-in event boundary. It would
not be global, would not drain recursively without a budget, and would preserve
`root.flush()` as the deterministic primitive.

The first implementation should be a contract and instrumentation milestone,
not an automatic scheduler. Once the contract is approved, a microtask mode is
the most direct first primitive for event-driven scalar work. Frame scheduling
should remain opt-in for visual workloads. A transaction API can be evaluated if
microtask completion cannot express structural-plus-retained-field boundaries
clearly.

## Proposed decision matrix

All rows below are **PROPOSED** and require human approval.

| ID | Question | Proposed alternative | Evidence / risk | Approval |
| --- | --- | --- | --- | --- |
| D1 | Manual or automatic default? | Keep manual default; add opt-in mode | Preserves alpha.1 compatibility; avoids hidden timing | PROPOSED — human approval required |
| D2 | Scheduler location? | Root-owned coordinator | Matches cleanup and multiple-root isolation | PROPOSED — human approval required |
| D3 | Invalidation notification? | Runtime/root boundary notification, not global mutation hook | Must avoid exposing internal graph or cross-root coupling | PROPOSED — human approval required |
| D4 | First primitive? | Opt-in microtask after explicit boundary | Fits event updates; frame mode deferred | PROPOSED — human approval required |
| D5 | Work generated during flush? | Preserve snapshot; schedule bounded follow-up turn | Avoids recursive drain; completion must be explicit | PROPOSED — human approval required |
| D6 | `flush()` semantics? | Keep one-pass; add separate scheduled execution API | Existing tests and consumer reasoning remain valid | PROPOSED — human approval required |
| D7 | Coalescing? | One pending turn per root, FIFO within snapshot | Preserve dirty deduplication and order | PROPOSED — human approval required |
| D8 | Budgets/starvation? | Configurable bounded work budget and diagnostic result | Prevent self-invalidating loops from blocking browser | PROPOSED — human approval required |
| D9 | Reentrancy/cancellation? | Reject reentrant manual flush; cancel root-owned scheduled work on dispose | Matches current reentrant and cleanup contracts | PROPOSED — human approval required |
| D10 | Errors? | Structured error delivered at boundary and retained for inspection | Async timing must not turn errors into unhandled exceptions | PROPOSED — human approval required |
| D11 | Disposal with pending work? | Root disposal cancels scheduled work before dependent cleanup | Prevent stale DOM/runtime access | PROPOSED — human approval required |
| D12 | Multiple roots/runtimes? | No shared scheduler state across roots | Prevent cross-application interference | PROPOSED — human approval required |
| D13 | API migration? | Add opt-in API; preserve existing root APIs | Consumers can migrate incrementally | PROPOSED — human approval required |
| D14 | Acceptance methodology? | Correctness-first repeated browser runs plus benchmark integrity | Avoid accepting faster but incorrect execution | PROPOSED — human approval required |

No row authorizes framework code, public API changes, or ABI changes.

## Correctness invariants for any scheduler

Future implementation tests must cover:

- multiple writes before scheduled execution;
- equality-preserving writes;
- FIFO computation order and existing dirty deduplication;
- work generated during execution;
- retained item updates and nested structural updates;
- same-snapshot disposal and generational identity reuse;
- unknown computation rejection;
- reentrant scheduling and manual flush rejection;
- root unmount before scheduled work;
- runtime disposal and cleanup failure;
- scheduling cancellation and structured error propagation;
- bounded execution and self-invalidating computations;
- isolation between multiple roots.

These are future acceptance requirements, not passing alpha.1 tests.

## Proposed milestone decomposition

### M5.1 — Scheduling execution contract

Document observable states, completion boundaries, error delivery, and budget
semantics. Add source-level and runtime contract tests without automatic work.

### M5.2 — Root invalidation coordination

Introduce a private/root-local coordination mechanism and instrumentation while
keeping manual execution unchanged. Prove root isolation and cancellation.

### M5.3 — Opt-in automatic execution

Add the first approved scheduling primitive, initially microtask or explicit
event-boundary based, behind an opt-in API. Preserve one-pass `flush()`.

### M5.4 — Generated work, batching, and budgets

Specify bounded follow-up work, coalescing, starvation prevention, and retained
field completion. Use the consumer benchmark schema without weakening integrity.

### M5.5 — Lifecycle, failure, and cancellation hardening

Exercise scheduled work during root disposal, failed cleanup, runtime disposal,
reentrant calls, and error propagation.

### M5.6 — Consumer integration and performance validation

Opt selected examples into the scheduler, compare against the alpha.1 baseline,
and publish raw correctness/performance evidence.

Component-local state, lifecycle hooks, collection authoring APIs, JSX typing,
and bundler integration should remain separate milestones rather than expanding
M5 into an unreviewable feature set.

## Human approval questions

1. Is the manual-only default required for the first M5 release?
2. Should the first opt-in primitive be a microtask or an explicit transaction?
3. What is the maximum scheduled work budget and how is starvation reported?
4. Should scheduled errors be returned from an awaitable boundary, delivered to
   a root callback, or represented another way?
5. Is a public cancellation handle needed, or is root disposal sufficient?
6. Can the design remain TypeScript-only, or is a Rust/WASM ABI extension
   justified by measured evidence?
7. Which consumer examples should opt in first?

Until these questions are approved, alpha.1's manual one-pass execution remains
the only supported behavior.
