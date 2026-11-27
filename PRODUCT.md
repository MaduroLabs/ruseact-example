# Ruseact Example Product Context

## Status

This is a project-scoped draft for the frontend design workflow. The product
direction is intentionally conservative while the project owner reviews the
visual proposal.

## Product purpose

Ruseact Example is an independent, static consumer showcase for the
experimental Ruseact frontend framework. It lets a developer run small,
inspectable applications that demonstrate the framework's current public
contracts rather than presenting a production-ready product.

## Audience

- Frontend and runtime engineers evaluating Ruseact's architecture.
- Rust/WebAssembly developers curious about native DOM reactivity.
- Contributors who need a compact, reproducible consumer example.

## Primary user tasks

1. Understand what Ruseact is and why the examples exist.
2. Choose an example by capability, not by marketing promise.
3. Open a runnable demo and recognize the behavior being demonstrated.
4. Inspect the corresponding source, validation reports, and limitations.
5. Navigate between the five examples without losing orientation.

## Product positioning

The site is a credible experimental lab notebook: technically precise,
welcoming to investigation, and honest about alpha limitations. It should feel
intentional and authored without imitating a generic SaaS launch page.

## Technical constraints

- Preserve the installed private Ruseact `0.1.0-alpha.1` artifact set,
  checksums, WASM loading, and public example behavior.
- Preserve native HTML/CSS and the consumer-local Ruseact compilation path.
- Do not introduce another UI framework, router, asset CDN, analytics, or
  framework/runtime semantics.
- Keep the public build free of test-only control interfaces.
- Preserve keyboard access, visible focus, responsive behavior, and truthful
  experimental-status language.

## UI writing principles

- Lead with observable capabilities and concrete actions.
- Use the framework's actual vocabulary: signals, explicit flush, ownership,
  keyed identity, and native DOM behavior.
- Separate verified behavior from architectural intent and browser-specific
  observations.
- Prefer short action labels such as `Open demo`, `Inspect source`, and
  `Read validation report`.
- Never imply production readiness, React compatibility, automatic scheduling,
  performance superiority, or universal browser support.
