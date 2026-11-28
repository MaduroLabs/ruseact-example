# Ruseact Example Design Context

## Status

The **Open Page** visual direction was approved by the project owner on
2026-11-28 for implementation on `feat/playground-redesign`. This document is
the implementation reference for the redesign; it does not authorize changes
to the framework repository or deployment.

## Previous visual inventory

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

These findings are preserved as the rationale for replacing the previous
presentation. They do not describe framework defects.

## Approved direction — Open Page

Visual thesis: **an open technical workbench where each example is a labeled
capability, not a product-marketing card.**

The direction uses a light mineral paper surface, dark blue-green ink, one teal
action color, thin rules, and a compact example index. It deliberately removes
decorative eyebrows, section numbers, repeated cards, large marketing heroes,
and simulated interactions from the landing page.

### Approved system

- Typography: use a readable system sans for UI and body text. Body text is
  400, labels and controls are 400–500, headings are 500–600, and the page
  heading remains within a compact 26–32px scale. Reserve monospace for route
  paths and other technical data.
- Color: use the approved tokens `#eef2f1` paper, `#fbfcfb` surface,
  `#142934` ink, `#596c70` muted text, `#cbd8d5` rules, `#287875` teal,
  and `#1c5d5a` deep teal. Contrast must be verified in the rendered pages.
- Spacing: use a compact 8px-derived rhythm. Reduce hero dead space and keep
  the example surface close to the page orientation text.
- Layout: use a compact header, capability index, and one active example
  surface. On the landing page, links lead to the actual Ruseact applications;
  the page must not simulate their controls.
- Components: preserve native controls, explicit `root.flush()` behavior,
  visible `:focus-visible`, simple borders, and small-radius geometry. Group
  related data with rules or tint rather than nested rounded cards.
- Responsive behavior: keep the navigation compact, stack the index above the
  active surface, expose the primary example controls early, and verify every
  route at `1440x900` and `390x844`.

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

## Implementation boundary

The approved direction changes the consumer presentation only. It does not
change Ruseact runtime semantics, signal ownership, explicit flushing, keyed
identity, native input behavior, test instrumentation, package artifacts, or
public routes. All screenshots and audits must use the actual built
applications rather than the temporary prototype's simulated preview.
