# Ruseact Example Design Context

## Status

This is a project-scoped draft created for the frontend design quality
workflow. The proposed visual direction is **AWAITING HUMAN APPROVAL**. No
application UI has been redesigned in this task.

## Current visual inventory

Evidence source: Impeccable screenshots captured from the unchanged local
development server on 2026-11-27 at Chromium desktop `1440x900` and mobile
`390x844`.

- Background: pale blue-gray `#f4f7fb`.
- Primary text: deep navy/charcoal `#17202a` and `#17324c`.
- Secondary text: muted blue-gray `#55708d`.
- Accent/action blue: `#315d86`, with a light focus ring near `#7ab6f0`.
- Typography: Inter if available, then system sans; uppercase tracked eyebrow
  labels; large tight headings; readable body copy.
- Layout: centered `68rem` maximum width, roomy page padding, shared brand
  header, bordered white example card, subtle shadow, and responsive stacking.
- Landing: hero, technology list, repeated five-card showcase, honesty note,
  and footer links.
- Example pages: shared header/index treatment and a single large application
  card with native controls.

## Read-only critique snapshot

Evidence level: E3 rendered browser observation. Strengths are strong text
contrast at a glance, clear capability labels, consistent navigation, obvious
primary action, and a mobile layout that remains readable without horizontal
overflow in the inspected states.

Observed risks are visual/DX findings, not framework defects:

- The landing showcase relies on five similar rounded cards, which reads as a
  familiar template and gives each capability equal visual weight even when a
  developer may need a guided sequence.
- The desktop landing page leaves substantial unused vertical space around the
  hero and below the showcase; the first viewport could establish the product
  thesis and example path more deliberately.
- The mobile header moves the version pill below the brand, increasing the
  distance to the first content block.
- The Counter mobile screenshot shows the inline source action interrupting
  the explanatory sentence; a clearer action row would improve scanability.
- The examples use a shared rounded-card treatment that is consistent but may
  overuse containers as the site grows.

No redesign decision is made here. These findings require art-direction
approval before implementation.

## Proposed direction — awaiting human approval

Visual thesis: **an open technical workbench where each example is a labeled
experiment, not a product-marketing card.**

The direction would retain the current restrained light foundation and strong
readability, but make hierarchy more editorial and capability-led: a compact
orientation header, a sharper first-view thesis, a more deliberate example
sequence, and fewer repeated containers. The visual language should use
measured blue/ink contrast and restrained rule lines to suggest instrumentation
without decorative grids, glows, or novelty effects.

### Proposed system

- Typography: keep a highly readable sans for UI and body text; reserve a
  monospace face only for code, keys, and measured values if the surface needs
  it. Use a compact heading scale rather than escalating every section.
- Color: preserve the current accessible navy/blue-gray foundation; use one
  clear action blue, one experimental-status treatment, and semantic state
  colors only where an example needs them. Validate contrast before shipping.
- Spacing: keep a consistent 8px-derived rhythm, reduce unintentional hero
  dead space, and give the first example path priority over decorative padding.
- Layout: treat the index as a guided sequence with one strong primary path and
  supporting source/validation paths. Use cards only where grouping genuinely
  improves comparison or task completion.
- Components: preserve native controls, visible `:focus-visible`, simple
  borders, and small-radius geometry. Avoid nested cards, badge repetition, and
  visual effects without a functional explanation.
- Responsive behavior: keep the brand/version relationship compact on mobile,
  prevent inline actions from colliding with prose, and test every proposed
  change at `1440x900` and `390x844`.

## Reference research

- [Rust](https://www.rust-lang.org/): a technical project homepage that leads
  with a concise purpose statement, clear “Get Started” action, capability
  sections, and honest project/community context. Transferable principle:
  capability-led orientation. Not copied: Rust's branding, illustrations, or
  adoption/production claims.
- [MDN Web Docs](https://developer.mozilla.org/en-US/): a developer resource
  that prioritizes information architecture, technology navigation, search,
  and reference pathways. Transferable principle: let users choose a concrete
  technical path quickly. Not copied: its documentation taxonomy or density.
- [web.dev](https://web.dev/): a web platform resource organized around
  practical guidance, accessibility, performance, and browser reality.
  Transferable principle: make quality constraints visible and useful. Not
  copied: its Google/Chrome identity or editorial modules.

## Approval gate

The proposed direction is not approved. Before any major visual redesign,
the project owner must approve the thesis, world, hierarchy, type/color system,
and scope. A later implementation must run the actual app, capture and inspect
desktop/mobile screenshots, receive an independent critique, and use
Impeccable `critique`, `audit`, and `polish` at the appropriate stages.
